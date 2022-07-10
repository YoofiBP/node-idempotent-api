import {z} from "zod";
import {IdempotencyKeyParams, RideCreationParams, RideDestinationParams} from "./zodSchemas";
import {idempotency_keys} from "@prisma/client";
import prisma from "./database";
import {AtomicPhaseOutput, RecoveryPoint, RecoveryPointEnum, Response, TransactionError} from "./utils";
import isEqual from "lodash/isEqual";
import dayjs from "dayjs";
import axios from "axios";

export const getRequestKeyResponse = async (idemKey: idempotency_keys) => {
    return await prisma.idempotency_keys.findUnique({
        where: {
            id: (idemKey as idempotency_keys).id
        },
        select: {
            response_code: true,
            response_body: true
        }
    })
}

export const createOrUpdateIdemKey =
    async ({keyValue, ...rest}: z.infer<typeof IdempotencyKeyParams>): Promise<idempotency_keys | null> => {
        let idemKey: idempotency_keys | null = null;
        await prisma.$transaction(async (_) => {
            idemKey = await prisma.idempotency_keys.findFirst({
                where: {
                    idempotency_key: keyValue
                }
            });

            if (!idemKey) {
                idemKey = await createIdempotencyKey({keyValue, ...rest})
            } else {
                if (!isEqual(idemKey.request_params, rest.requestParams)) {
                    throw new TransactionError(
                        {
                            status: 409,
                            message: 'Different params used'
                        }
                    )
                }
                if (dayjs(idemKey.locked_at).isAfter(dayjs(new Date()).subtract(90, 'seconds'))) {
                    throw new TransactionError({
                        status: 409,
                        message: 'Key locked'
                    })
                }
                if (idemKey.recovery_point !== RecoveryPointEnum.finished) {
                    idemKey = await prisma.idempotency_keys.update({
                        where: {
                            id: idemKey.id
                        },
                        data: {
                            last_run_at: new Date(),
                            locked_at: new Date()
                        }
                    })
                }
            }
        })
        return idemKey;
    }

const createIdempotencyKey =
    async ({
               keyValue,
               requestMethod,
               requestPath,
               requestParams,
               userId
           }: z.infer<typeof IdempotencyKeyParams>): Promise<idempotency_keys> => {
        return await prisma.idempotency_keys.create({
            data: {
                request_method: requestMethod,
                request_params: requestParams,
                request_path: requestPath,
                user_id: userId,
                idempotency_key: keyValue,
                recovery_point: RecoveryPointEnum.started
            }
        })
    }
export const atomicPhase = async (key: idempotency_keys, phase: () => Promise<AtomicPhaseOutput>) => {
    try {
        await prisma.$transaction(async (_) => {
            const output = await phase();
            await output.call(key);
        })
    } catch (e) {
        await prisma.idempotency_keys.update({
            where: {
                id: key.id
            },
            data: {
                locked_at: null
            }
        })
        throw e;
    }
}

const createRide = async ({
                              idempotencyKeyId,
                              originLat,
                              originLon,
                              targetLat,
                              targetLon,
                              userID
                          }: z.infer<typeof RideCreationParams>) => {
    try {
        await prisma.rides.create({
            data: {
                idempotency_key_id: idempotencyKeyId,
                origin_lat: originLat,
                origin_lon: originLon,
                target_lat: targetLat,
                target_lon: targetLon,
                user_id: userID
            }
        })
        return new RecoveryPoint({recoveryPoint: RecoveryPointEnum.ride_created})
    }  catch (e) {
        return new Response({
            status: 500,
            body: {
                error: "Could not create ride"
            }
        })
    }

}

const createStripeCharge = async () => {
    const response = await axios.get<string, { data: { chargeID: string } }>('https://run.mocky.io/v3/9c821b99-ab61-4d09-9fda-b70442b47d13');
    return response.data;
}

export const performRideSetup = async (key: idempotency_keys, params: z.infer<typeof RideDestinationParams>) => {
    outside:
        while (true) {
            const idemKey = await prisma.idempotency_keys.findUnique({
                where: {
                    id: key.id
                }
            })

            if (!idemKey) {
                throw new TransactionError({
                    message: 'Key does not exist'
                })
            }
            switch (idemKey.recovery_point) {
                case RecoveryPointEnum.started:
                    await atomicPhase(idemKey, async () => createRide({
                        idempotencyKeyId: idemKey.id,
                        originLat: params.originLat,
                        originLon: params.originLon,
                        targetLat: params.targetLat,
                        targetLon: params.targetLon,
                        userID: 1
                    }))
                    break;
                case RecoveryPointEnum.ride_created:
                    await atomicPhase(idemKey, async () => {
                        try {
                            const {chargeID} = await createStripeCharge();
                            if(!chargeID) {
                                throw new TransactionError({
                                    status: 402,
                                    message: 'Stripe rejected payment'
                                })
                            }
                            const ride = await prisma.rides.findFirst({
                                where: {
                                    idempotency_key_id: idemKey.id
                                }
                            });
                            if (!ride) {
                                throw new TransactionError(
                                    {message: 'Ride not found'}
                                )
                            }
                            await prisma.rides.update({
                                where: {
                                    id: ride.id
                                },
                                data: {
                                    stripe_charge_id: chargeID
                                }
                            })
                            return new RecoveryPoint({
                                recoveryPoint: RecoveryPointEnum.charge_created
                            })
                        } catch (e) {
                            return new Response({
                                status: 500,
                                body: {
                                    message: 'error creating stripe charge'
                                }
                            })
                        }

                    })
                    break;
                case RecoveryPointEnum.charge_created:
                    await atomicPhase(idemKey, async () => {
                        try {
                            const ride = await prisma.rides.findFirst({
                                where: {
                                    idempotency_key_id: idemKey.id
                                }
                            });
                            if (!ride) {
                                throw new TransactionError({
                                    message: 'ride not found'
                                })
                            }
                            await prisma.staged_jobs.create({
                                data: {
                                    job_name: 'send_ride_receipt',
                                    job_args: {
                                        amount: 20,
                                        currency: "USD",
                                        userID: ride.user_id.toString()
                                    }
                                }
                            })
                            return new Response({
                                status: 201,
                                body: {
                                    message: "ride created"
                                }
                            })
                        } catch (e) {
                            return new Response({
                                status: 500,
                                body: {
                                    message: 'error updating ride info'
                                }
                            })
                        }
                    })
                    break;
                case RecoveryPointEnum.finished:
                    break outside;
                default:
                    throw new Error('Unsupported recovery point')
            }

        }
    console.log('Job completed');
}