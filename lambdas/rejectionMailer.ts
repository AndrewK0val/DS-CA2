import { SendBounceCommand, SES, SESClient, SendEmailCommand, SendEmailCommandInput } from "@aws-sdk/client-ses";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "env";
import { ContactDetails } from "/opt/types";
import { SQS } from "@aws-sdk/client-sqs";
import { SQSHandler } from "aws-lambda";

if (!SES_EMAIL_FROM || !SES_EMAIL_TO || !SES_REGION) {
    throw new Error(
        "Misconfigured environment variables in env.js. Please make sure that variables: SES_EMAIL_TO, SES_EMAIL_FROM and SES_REGION are present"
    )
}



const client = new SESClient({region: SES_REGION})

export const handler: SQSHandler = async (event) => {
    console.log("DLQ Event: ", JSON.stringify(event))

    for(const record of event.Records) {
    try{
        const recordBody = JSON.parse(record.body)

        try {
            const snsMessage = JSON.parse(recordBody.Message)
            const s3Event = snsMessage?.Records?.[0]?.s3
            const srcKey = decodeURIComponent(s3Event?.object?.key || "Unknown file")
            if (srcKey.endsWith("jpeg") || srcKey.endsWith("jpg") || srcKey.endsWith("png"))
                console.log(`file type ${srcKey} is valid and should not be in DLQ`)
                continue

                const {name, email, message}: ContactDetails = {
                    name: "File Rejection",
                    email: SES_EMAIL_FROM,
                    message: `Invalid file type. Please make sure that the image is either JPG/JPEG or PNG format!`
                }
                const params = sendEmailParams({name, email, message})
                await client.send(new SendEmailCommand(params))
            } catch (error) {
                console.error("Error: Failed to process the SNS message", error)
            }
        } catch (error) {
            console.error("Error parsing record body")
        }
    }
}

function sendEmailParams({ name, email, message }: ContactDetails) {
    const parameters: SendEmailCommandInput = {
        Destination: {
        ToAddresses: [SES_EMAIL_TO],
        },
        Message: {
        Body: {
            Html: {
            Charset: "UTF-8",
            Data: getHtmlContent({ name, email, message }),
            },
            // Text: {.           // For demo purposes
            //   Charset: "UTF-8",
            //   Data: getTextContent({ name, email, message }),
            // },
        },
        Subject: {
            Charset: "UTF-8",
            Data: `New image Upload`,
        },
        },
        Source: SES_EMAIL_FROM,
    };
    return parameters;
    }

    function getHtmlContent({ name, email, message }: ContactDetails) {
        return `
            <html>
            <body>
                <h2>Sent from: </h2>
                <ul>
                <li style="font-size:18px">👤 <b>${name}</b></li>
                <li style="font-size:18px">✉️ <b>${email}</b></li>
                </ul>
                <p style="font-size:18px">${message}</p>
            </body>
            </html> 
        `;
    }
        
    // For demo purposes - not used here.
    function getTextContent({ name, email, message }: ContactDetails) {
    return `
        Received an Email. 📬
        Sent from:
            👤 ${name}
            ✉️ ${email}
        ${message}
    `;
    }