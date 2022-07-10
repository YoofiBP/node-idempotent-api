import prisma from "./db";
import {idempotency_keys} from '@prisma/client'

export type AtomicPhaseOutput = Response | RecoveryPoint | NoOp;

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

