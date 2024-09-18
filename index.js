const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const admin = require('firebase-admin');
require('dotenv').config(); // To load environment variables

const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
    origin: 'http://localhost:3000' // Allow only your frontend origin
}));

// Initialize Firebase Admin
const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();

// Initialize Twilio
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Parse incoming requests
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Send WhatsApp notification
app.post('/send-notification', async (req, res) => {
    const whatsappNumber  = req.body.phoneNumber;
    const message = 'Please upload an image within the next 15 minutes.';

    try {
        console.log(req.body);
        const response = await twilioClient.messages.create({
            body: message,
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
            to: `whatsapp:${whatsappNumber}`
        });

        res.status(200).send({ message: 'Notification sent successfully', sid: response.sid });
    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).send({ error: 'Failed to send notification' });
    }
});

// Twilio webhook endpoint
app.post('/whatsapp/webhook', async (req, res) => {
    const numMedia = req.body.NumMedia || 0;
    const senderWaId = req.body.WaId;  // WhatsApp ID of the sender
    const twiml = new twilio.twiml.MessagingResponse();

    if (numMedia > 0) {
        // Loop through media files if there are multiple
        const mediaUrls = [];
        for (let i = 0; i < numMedia; i++) {
            const mediaUrl = req.body[`MediaUrl${i}`];
            mediaUrls.push(mediaUrl);
        }

        // Save the media URLs to Firestore along with sender's WaId
        try {
            await db.collection('whatsappMedia').add({
                senderWaId: senderWaId,
                mediaUrls: mediaUrls,
                uploadedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Saved media from WaId ${senderWaId}: ${mediaUrls}`);

            // Respond to WhatsApp with a thank you message
            twiml.message('Thanks for sending the image(s)!');
        } catch (error) {
            console.error('Error saving media URL to Firestore:', error);
            twiml.message('There was an error saving your image.');
        }
    } else {
        // Handle text received
        const message = req.body.Body;
        console.log(`Received message from ${senderWaId}: ${message}`);
        twiml.message('Thanks for the message!');
    }

    // Make sure we respond only once
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
});

// Fetch the most recent 5 images for a given WaId
app.get('/whatsapp/images/:waId', async (req, res) => {
    let senderWaId = req.params.waId;

    try {
        senderWaId = senderWaId.slice(1);
        console.log(senderWaId);
        const mediaQuerySnapshot = await db.collection('whatsappMedia')
            .where('senderWaId', '==', senderWaId)
            .orderBy('uploadedAt', 'desc')
            .limit(5)
            .get();

        const mediaUrls = [];
        mediaQuerySnapshot.forEach(doc => mediaUrls.push(...doc.data().mediaUrls));
    console.log(mediaUrls);
        res.status(200).json({ urls: mediaUrls });
    } catch (error) {
        console.error('Error fetching media:', error);
        res.status(500).send('Error fetching media.');
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
