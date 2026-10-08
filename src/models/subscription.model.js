const mongoose = require('mongoose');
const { Schema } = mongoose;

const paymentInfoSchema = new mongoose.Schema({
  fromDate: { type: Date },
  toDate: { type: Date },
  priceAmountMicros: { type: Number },
  priceCurrencyCode: { type: String },
  countryCode: { type: String },
  paymentState: { type: Number },
  cancelReason: { type: Number },
  acknowledgementState: { type: Number }
}, { _id: false });

const subscriptionSchema = new mongoose.Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  provider: { type: String, enum: ['google_play', 'stripe'], default: 'google_play', index: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  subscriptionId: { type: String, required: true },
  packageName: { type: String, required: true },
  purchaseToken: { type: String, required: true },
  offerToken: { type: String, required: true },
  orderId: { type: String, required: true },
  externalSubscriptionId: { type: String },
  externalCustomerId: { type: String },
  status: { type: String },
  currentPeriodStart: { type: Date },
  currentPeriodEnd: { type: Date },
  cancelAtPeriodEnd: { type: Boolean, default: false },
  paymentInfo: { type: paymentInfoSchema }
}, {
  versionKey: false
});

subscriptionSchema.index({ purchaseToken: 1 }, { unique: true });
subscriptionSchema.index({ externalSubscriptionId: 1 }, { unique: true, sparse: true });
subscriptionSchema.index({ userId: 1, 'paymentInfo.fromDate': 1, 'paymentInfo.toDate': 1 });
subscriptionSchema.index({ userId: 1, 'paymentInfo.fromDate': -1, 'paymentInfo.toDate': -1 });

module.exports = mongoose.model('Subscription', subscriptionSchema, 'subscriptions');
