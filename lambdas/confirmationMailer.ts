import { SendEmailCommand, SendEmailCommandInput, SESClient } from "@aws-sdk/client-ses";
import { DynamoDBStreamHandler } from "aws-lambda";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "env";

const client = new SESClient({region: SES_REGION})

export const handler: DynamoDBStreamHandler = async (event) => {
    console.log("DDB stream event: ", JSON.stringify(event))
    for ( const record of event.Records) {

        if (record.eventName === "INSERT" && record.dynamodb?.NewImage) {
            const newImage = record.dynamodb.NewImage
            const imageName = newImage.ImageName?.S
            if (!newImage || !newImage.ImageName || !newImage.ImageName.S) {
                console.warn("Missing Image Name in Database")
                continue
            }
    
            const message = `New Image Uploaded: ${imageName}`
            const params: SendEmailCommandInput = { 
                Destination: {ToAddresses: [SES_EMAIL_TO]},
                Message: { 
                    Body: {
                        Text: {Data: message},
                    },
                    Subject: {Data: "New Image Uploaded"}
                },
                Source: SES_EMAIL_TO,
            }
    
            try {
                await client.send(new SendEmailCommand(params))
                console.log(`Email has been sent for image: ${imageName}`)
            } catch (error) {
                console.log(`Error: ${error}`)
            }
        } else {
             console.warn(
                `Record skipped: ${JSON.stringify(record)}`
             )
        }
    }
}

