import { SQSHandler } from "aws-lambda";
import {BadOrder } from './../shared/types'

export const handler: SQSHandler = async (event) => {
  try {
    console.log("Event: ", JSON.stringify(event));
    for (const record of event.Records) {
      const message : BadOrder = JSON.parse(record.body) as BadOrder
      console.log(message.customerName);
    }
  } catch (error) {
    console.log(JSON.stringify(error));
  }
};
