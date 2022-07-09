import express from "express";
import bodyParser from "body-parser";
import {z} from 'zod';
import {IdempotencyKeyParams} from "./zodSchemas";
import prisma from "./db";
import {performAsyncJob, RecoveryPointEnum, TransactionError} from "./utils";
import {idempotency_keys} from "@prisma/client";
import isEqual from 'lodash/isEqual';
import dayjs from 'dayjs';

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true}))

const createOrUpdateIdemKey = async ({keyValue, ...rest}: z.infer<typeof IdempotencyKeyParams>): Promise<idempotency_keys> => {
    const idemKey = await prisma.idempotency_keys.findFirst({
        where: {
            idempotency_key: keyValue
        }
    });

    if(!idemKey){
        return await createIdempotencyKey({keyValue, ...rest})
    } else {
        if(!isEqual(idemKey.request_params, rest.requestParams)){
            throw new TransactionError(
                {
                    message: 'Different params used'
                }
            )
        }
        if(dayjs(idemKey.locked_at).isAfter(dayjs(new Date()).subtract(90, 'seconds'))) {
            throw new TransactionError({
                message: 'Key locked'
            })
        }
        if(idemKey.recovery_point !== RecoveryPointEnum.finished){
            return await prisma.idempotency_keys.update({
                where: {
                    id: idemKey.id
                },
                data: {
                    last_run_at: new Date(),
                    locked_at: new Date()
                }
            })
        }
        return idemKey;
    }
}

const createIdempotencyKey = async ({keyValue, requestMethod, requestPath, requestParams, userId}: z.infer<typeof IdempotencyKeyParams>): Promise<idempotency_keys> => {
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

app.post('/rides', async (req, res) => {
    try {
        const key = req.headers['idempotency-key'];
        if(typeof key !== 'string'){
            throw new Error();
        }
        let idemKey: idempotency_keys | null = null;
        await prisma.$transaction(async (_) => {
            idemKey = await createOrUpdateIdemKey({
                keyValue: key,
                requestMethod: req.method,
                requestParams: req.body,
                requestPath: req.path,
                userId: 1
            })
        })
        if(!idemKey){
            throw Error();
        }
        const {originLat, originLon, targetLat, targetLon} = req.body;
        await performAsyncJob(idemKey, {
            originLat,
            originLon,
            targetLon,
            targetLat
        });
        const response = await prisma.idempotency_keys.findUnique({
            where: {
                id: (idemKey as idempotency_keys).id
            },
            select: {
                response_code: true,
                response_body: true
            }
        })
        if(!response?.response_code || !response?.response_body){
            throw new Error();
        }
        return res.status(response.response_code).send(response.response_body);
    } catch (e) {
        console.error(e)
        if(e instanceof TransactionError){
            return res.status(e.status).send({
                error: e.message
            })
        }
        return res.status(500).send({
            error: 'error occurred'
        })
    }
})

export default app;