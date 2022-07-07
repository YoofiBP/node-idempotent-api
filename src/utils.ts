import prisma from "./db";
import { idempotency_keys } from '@prisma/client'

interface AtomicPhaseOutput {
    call: (key: idempotency_keys) => void;
}

class RecoveryPoint implements AtomicPhaseOutput {
    call(key: idempotency_keys) {

    }
}

class Response implements AtomicPhaseOutput {
    call(key: idempotency_keys ) {
        prisma.idempotency_keys.update({
            where: {
                id: key.id
            },
            data: {

            }
        })
    }
}

class NoOp implements AtomicPhaseOutput {
    call(key: idempotency_keys) {

    }
}

const atomicPhase = async (key:idempotency_keys, actions: () => Promise<AtomicPhaseOutput>) => {
    try {
        await prisma.$transaction( async (prisma) => {
            const output = await actions();
            output.call(key);
        })
    } catch (e) {
        
    }
    return actions();
}