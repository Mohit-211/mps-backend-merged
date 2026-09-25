import crypto from 'crypto';

function generateRandomString(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let randomString = '';
  const randomBytes = crypto.randomBytes(length);

  for (const byte of randomBytes) {
    const randomIndex = byte % charset.length;
    randomString += charset.charAt(randomIndex);
  }

  return randomString;
}

export default generateRandomString;
