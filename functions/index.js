const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(functions.config().stripe.secret);

admin.initializeApp();

exports.createUser = functions.https.onCall(async (data, context) => {
  const { email, password, displayName } = data;

  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName,
    });

    await admin.firestore().collection('users').doc(userRecord.uid).set({
      displayName,
      email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { uid: userRecord.uid };
  } catch (error) {
    throw new functions.https.HttpsError('internal', error.message);
  }
});

exports.getSignedUrl = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to upload a resume.');
  }

  const { fileName, contentType } = data;
  const bucket = admin.storage().bucket();
  const file = bucket.file(`resumes/${context.auth.uid}/${fileName}`);

  const options = {
    version: 'v4',
    action: 'write',
    expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    contentType,
  };

  const [url] = await file.getSignedUrl(options);

  return { url };
});

exports.createReview = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to create a review.');
  }

  const { companyId, title, pros, cons, rating } = data;

  const review = {
    userId: context.auth.uid,
    companyId,
    title,
    pros,
    cons,
    rating,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    isPublished: false,
    votes: {},
    likes: [],
  };

  const reviewRef = await admin.firestore().collection('reviews').add(review);

  return { id: reviewRef.id };
});

exports.voteOnReview = functions.firestore.document('reviews/{reviewId}')
  .onUpdate(async (change, context) => {
    const reviewId = context.params.reviewId;
    const review = change.after.data();

    if (review.isPublished) {
      return null;
    }

    const votes = Object.values(review.votes);
    const totalVotes = votes.length;

    if (totalVotes < 10) {
      return null;
    }

    const approvalCount = votes.filter(vote => vote === true).length;
    const approvalPercentage = approvalCount / totalVotes;

    if (approvalPercentage >= 0.6) {
      await admin.firestore().collection('reviews').doc(reviewId).update({
        isPublished: true,
      });
    }

    return null;
  });

exports.requestCvFeedback = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to request CV feedback.');
  }

  const { expertId, resumeUrl } = data;

  const feedback = {
    userId: context.auth.uid,
    expertId,
    resumeUrl,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const feedbackRef = await admin.firestore().collection('cvFeedback').add(feedback);

  return { id: feedbackRef.id };
});

exports.createStripeCheckout = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to make a payment.');
  }

  const { feedbackId } = data;

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'CV Feedback',
          },
          unit_amount: 2000, // $20
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `https://your-app.com/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `https://your-app.com/cancel`,
    metadata: {
      feedbackId,
      userId: context.auth.uid,
    },
  });

  return { id: session.id };
});

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = functions.config().stripe.webhook_secret;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { feedbackId, userId } = session.metadata;

    await admin.firestore().collection('cvFeedback').doc(feedbackId).update({
      status: 'paid',
    });

    // You might want to send a notification to the expert here
  }

  res.json({ received: true });
});

exports.respondToReview = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to respond to a review.');
  }

  const { reviewId, response } = data;

  const reviewRef = admin.firestore().collection('reviews').doc(reviewId);
  const review = (await reviewRef.get()).data();

  const companyId = review.companyId;
  const companyRef = admin.firestore().collection('companies').doc(companyId);
  const company = (await companyRef.get()).data();

  // This is a simplified check. In a real app, you'd have a more robust subscription model.
  if (!company.isSubscribed && company.responses > 5) {
    throw new functions.https.HttpsError('permission-denied', 'You have reached the free response limit. Please subscribe to respond to more reviews.');
  }

  await reviewRef.update({
    companyResponse: {
      response,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  });

  await companyRef.update({
    responses: admin.firestore.FieldValue.increment(1),
  });

  return { success: true };
});
