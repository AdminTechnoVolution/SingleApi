const test = require('node:test');
const assert = require('node:assert/strict');
const { loginSchema, logoutSchema, refreshTokenSchema } = require('../src/validators/auth.validator');
const { pushTokenSchema } = require('../src/validators/device.validator');
const User = require('../src/models/user.model');

const googleLogin = {
  email: 'person@example.com',
  authMethod: 'google',
  socialToken: 'google-id-token'
};

test('keeps the existing Android Google login contract', () => {
  const result = loginSchema.validate({ ...googleLogin, fcmToken: 'android-fcm-token' });
  assert.equal(result.error, undefined);
  assert.equal(result.value.platform, undefined);
});

test('accepts only supported platform values on login', () => {
  assert.equal(loginSchema.validate({ ...googleLogin, platform: 'iOS' }).error, undefined);
  assert.equal(loginSchema.validate({ ...googleLogin, platform: 'Android' }).error, undefined);
  assert.ok(loginSchema.validate({ ...googleLogin, platform: 'Windows' }).error);
  assert.equal(refreshTokenSchema.validate({ refreshToken: 'refresh', platform: 'iOS' }).error, undefined);
  assert.equal(refreshTokenSchema.validate({ refreshToken: 'refresh' }).error, undefined);
});

test('defaults new user documents to Android', () => {
  assert.equal(new User({}).platform, 'Android');
});

test('allows the PWA to login before requesting notification permission', () => {
  const result = loginSchema.validate({ ...googleLogin, fcmToken: '' });
  assert.equal(result.error, undefined);
});

test('keeps the deployed password login contract for Android compatibility', () => {
  const result = loginSchema.validate({
    email: 'person@example.com',
    password: 'ExistingPassword1',
    fcmToken: 'android-fcm-token'
  });
  assert.equal(result.error, undefined);
});

test('keeps logout compatible with Android and permits a missing PWA push token', () => {
  assert.equal(logoutSchema.validate({ accessToken: 'access', refreshToken: 'refresh', fcmToken: 'android-fcm-token' }).error, undefined);
  assert.equal(logoutSchema.validate({ accessToken: 'access', refreshToken: 'refresh' }).error, undefined);
});

test('validates push token registration independently from login', () => {
  assert.equal(pushTokenSchema.validate({ token: 'web-fcm-token' }).error, undefined);
  assert.ok(pushTokenSchema.validate({ token: '' }).error);
});
