import { SQSHandler } from "aws-lambda";
import { eventNames } from "process";

export const handler: SQSHandler = async (event) => {
    console.log("Event ", JSON.stringify(event))
}