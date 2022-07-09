import prisma from "./db";
import { idempotency_keys } from '@prisma/client'
import {z} from "zod";
import {RideInputParams} from "./zodSchemas";
import axios from "axios";

type AtomicPhaseOutput = Response | RecoveryPoint | NoOp;

interface AtomicPhaseCaller {
    call: (key: idempotency_keys) => Promise<void>;
}

export enum RecoveryPointEnum {
    started = 'started',
    finished = 'finished',
    ride_created = 'ride_created',
    charge_created = 'charge_created',
}

export class TransactionError {
    status: number;
    message: string;

    constructor({status, message}: {status?: number, message: string}) {
        this.status = status || 400;
        this.message = message;
    }
}

export class RecoveryPoint implements AtomicPhaseCaller {
    private readonly recoveryPoint: RecoveryPointEnum;

    constructor({recoveryPoint}: {recoveryPoint: RecoveryPointEnum; }) {
        this.recoveryPoint = recoveryPoint;
    }

    async call(key: idempotency_keys) {
        await prisma.idempotency_keys.update({
            where: {
                id: key.id
            },
            data: {
                recovery_point: this.recoveryPoint
            }
        });
    }
}

export class Response implements AtomicPhaseCaller {
    private readonly status: number;
    private readonly body: object;

    constructor({status, body}:{status:number; body:object,}) {
        this.status = status;
        this.body = body;
    }

    async call(key: idempotency_keys ) {
        await prisma.idempotency_keys.update({
            where: {
                id: key.id
            },
            data: {
                recovery_point: RecoveryPointEnum.finished,
                locked_at: null,
                response_code: this.status,
                response_body: this.body
            }
        })
    }
}

export class NoOp implements AtomicPhaseCaller {
    async call(_: idempotency_keys) {

    }
}

export const atomicPhase = async (key:idempotency_keys, phase: () => Promise<AtomicPhaseOutput>) => {
    try {
        await prisma.$transaction( async (_) => {
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

const createRide = async ({idempotencyKeyId, originLat, originLon, targetLat, targetLon, userID}: z.infer<typeof RideInputParams>) => {
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
}

const createStripeCharge = async () => {
    const response = await axios.get<string,{data: {chargeID: string}}>('https://run.mocky.io/v3/9c821b99-ab61-4d09-9fda-b70442b47d13');
    return response.data;
}

export const performAsyncJob = async (key:idempotency_keys, params:any) => {
    outside:
    while(true){
        const idemKey = await prisma.idempotency_keys.findUnique({
            where: {
                id: key.id
            }
        })

        if(!idemKey){
            throw new TransactionError({
                message: 'Key does not exist'
            })
        }
        switch(idemKey.recovery_point){
            case RecoveryPointEnum.started:
                await atomicPhase(idemKey, async() => createRide({
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
                    const {chargeID} = await createStripeCharge();
                    const ride = await prisma.rides.findFirst({
                        where: {
                            idempotency_key_id: idemKey.id
                        }
                    });
                    if(!ride){
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
                })
                break;
            case RecoveryPointEnum.charge_created:
                await atomicPhase(idemKey, async () => {
                    const ride = await prisma.rides.findFirst({
                        where: {
                            idempotency_key_id: idemKey.id
                        }
                    });
                    if(!ride){
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
                })
                break;
            case RecoveryPointEnum.finished:
                break outside;
        }

    }
    console.log('Job completed');
}