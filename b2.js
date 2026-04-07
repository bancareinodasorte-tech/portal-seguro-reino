const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const client = new S3Client({
  region: "us-east-005",
  endpoint: "https://s3.us-east-005.backblazeb2.com",
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
});

async function uploadArquivo(nome, buffer, tipo) {
  const command = new PutObjectCommand({
    Bucket: process.env.B2_BUCKET,
    Key: nome,
    Body: buffer,
    ContentType: tipo || "application/octet-stream",
  });

  await client.send(command);
}

async function gerarLink(nome) {
  const command = new GetObjectCommand({
    Bucket: process.env.B2_BUCKET,
    Key: nome,
  });

  const url = await getSignedUrl(client, command, { expiresIn: 60 });

  return url;
}

module.exports = {
  uploadArquivo,
  gerarLink,
};