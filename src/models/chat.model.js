const mongoose = require("mongoose");
const { Schema } = mongoose;

const lastMessageSchema = new Schema({
    content: String,
    sender: { type: Schema.Types.ObjectId, ref: "User" },
    created_at: Date
}, { _id: false });

const chatSchema = new Schema({
    _id: { type: Schema.Types.ObjectId, ref: "Match" },
    users: [{ type: Schema.Types.ObjectId, ref: "User" }],
    lastMessage: { type: lastMessageSchema },
    unreadCounts: {
        type: Map,
        of: Number,
        default: {}
    },
    deletedAt: {
        type: Map,
        of: Date,
        default: {}
    },
    created_at: { type: Date, default: Date.now }
}, { versionKey: false });

chatSchema.index({ "users.0": 1, "users.1": 1 });
chatSchema.index({ "lastMessage.created_at": -1 });

module.exports = mongoose.model("Chat", chatSchema, "chats");
