import {z} from 'zod';

export const IdempotencyKeyParams = z.object({
    keyValue: z.string(),
    requestMethod: z.string(),
    requestParams: z.object({}),
    requestPath: z.string(),
    userId: z.number()
})

export const RideCreationParams = z.object({
    originLat: z.number(),
    originLon: z.number(),
    targetLat: z.number(),
    targetLon: z.number(),
    userID: z.number(),
    idempotencyKeyId: z.bigint(),
    stripeChargeId: z.string().optional()
})

export const RideDestinationParams = RideCreationParams.pick({
    originLat: true,
    originLon: true,
    targetLat: true,
    targetLon: true
})