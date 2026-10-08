require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const filename = path.basename(__filename);
const logger = require('./shared/config/logger');
const helmet = require('helmet');
const { setupWebSocketServer } = require('./shared/config/ws');
const mongoose = require('./shared/config/mongo');
const redisClient = require('./shared/config/redis');
const discoverRoutes = require('./src/routes/discover.route');
const dietHabitRoutes = require('./src/routes/dietHabit.route');
const drinkingHabitRoutes = require('./src/routes/drinkingHabit.route');
const zodiacSignRoutes = require('./src/routes/zodiacSign.route');
const artistRoutes = require('./src/routes/artist.route');
const musicGenresRoutes = require('./src/routes/musicGenres.route');
const exerciseHabitRoutes = require('./src/routes/exerciseHabit.route');
const familyPlanRoutes = require('./src/routes/familyPlan.route');
const genderRoutes = require('./src/routes/gender.route');
const languageRoutes = require('./src/routes/language.route');
const healthRoutes = require('./src/routes/health.route');
const reportReasonRoutes = require('./src/routes/reportReason.route');
const likesRoutes = require('./src/routes/likes.route');
const dislikesRoutes = require('./src/routes/dislikes.route');
const reportRoutes = require('./src/routes/report.route');
const lookingForRoutes = require('./src/routes/lookingFor.route');
const sexualOrientationRoutes = require('./src/routes/sexualOrientation.route');
const smokingHabitRoutes = require('./src/routes/smokingHabit.route');
const subscriptionRoutes = require('./src/routes/subscription.route')
const SubscriptionController = require('./src/controllers/subscription.controller');
const matchRoutes = require('./src/routes/match.route');
const chatRoutes = require('./src/routes/chat.route');
const userRoutes = require('./src/routes/user.route');
const loginRoutes = require('./src/routes/auth.route');
const googleRoutes = require('./src/routes/google.route');
const wsRoutes = require('./src/routes/ws.route');
const deviceRoutes = require('./src/routes/device.route');
const exceptionHandler = require('./shared/exceptionHandler/exceptionHandler');
const correlationMiddleware = require('./shared/middlewares/correlationMiddleware');
const requestLogger = require('./shared/middlewares/requestLogger');
const responseLogger = require('./shared/middlewares/responseLogger');
const { swaggerUi, swaggerSpec } = require('./shared/config/swagger');
const app = express();

app.set("trust proxy", true);
app.use(correlationMiddleware);
app.use(cors());
app.use(helmet());
app.post('/api/subscription/stripe/webhook', express.raw({ type: 'application/json' }), SubscriptionController.stripeWebhook);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(responseLogger);

app.use('/api/', loginRoutes);
app.use('/api/', matchRoutes);
app.use('/api/', chatRoutes);
app.use('/api/', healthRoutes);
app.use('/api/actions/', likesRoutes);
app.use('/api/actions/', dislikesRoutes);
app.use('/api/actions/', reportRoutes);
app.use('/api/master', dietHabitRoutes);
app.use('/api/master', drinkingHabitRoutes);
app.use('/api/master', artistRoutes);
app.use('/api/master', musicGenresRoutes);
app.use('/api/master', exerciseHabitRoutes);
app.use('/api/master', familyPlanRoutes);
app.use('/api/master', genderRoutes);
app.use('/api/master', languageRoutes);
app.use('/api/master', lookingForRoutes);
app.use('/api/master', reportReasonRoutes);
app.use('/api/master', sexualOrientationRoutes);
app.use('/api/master', smokingHabitRoutes);
app.use('/api/master', zodiacSignRoutes);
app.use('/api/rtdn', googleRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/user', discoverRoutes);
app.use('/api/user', userRoutes);
app.use('/api/user', deviceRoutes);
app.use('/api', wsRoutes);
app.use(exceptionHandler);

const server = http.createServer(app);

if (process.env.ENABLE_SWAGGER === 'true') {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    logger.info('Swagger documentation enabled', { className: filename });
}

setupWebSocketServer(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info(`Single Backend App server running on port ${PORT}`, { className: filename })

    mongoose.connectWithRetry();
    redisClient.connect();
});
