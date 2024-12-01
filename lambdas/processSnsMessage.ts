import { SNSHandler } from "aws-lambda";

export const handler: SNSHandler = async (event) => {
    console.log("Event ", JSON.stringify(event))
}