import express from "express";
import bodyParser from "body-parser";
import {TransactionError} from "./utils";
import {createOrUpdateIdemKey, getRequestKeyResponse, performRideSetup} from "./services";
import {RideDestinationParams} from "./zodSchemas";

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true}))

app.post('/rides', async (req, res) => {
    try {
        const key = req.headers['idempotency-key'];

        if(typeof key !== 'string'){
            throw new Error();
        }

        const idemKey = await createOrUpdateIdemKey({
            keyValue: key,
            requestMethod: req.method,
            requestParams: req.body,
            requestPath: req.path,
            userId: 1
        })

        if(!idemKey){
            throw Error();
        }

        const {originLat, originLon, targetLat, targetLon} = RideDestinationParams.parse(req.body);
        await performRideSetup(idemKey, {
            originLat,
            originLon,
            targetLon,
            targetLat
        });

        const response = await getRequestKeyResponse(idemKey);
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