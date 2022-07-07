import { PrismaClient } from '@prisma/client'

type globalInterface = typeof globalThis

interface CustomNodeJsGlobal extends globalInterface {
    prisma: PrismaClient
}

declare const global: CustomNodeJsGlobal

const prisma = global.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
    global.prisma = prisma;
}

prisma.$connect().then(() => {
    console.log(`Database connected`)
})

export default prisma

