import app from "./express";
import config from "./config";

app.listen(config.port, () => {
    console.log(`Serving on port ${config.port}`)
})