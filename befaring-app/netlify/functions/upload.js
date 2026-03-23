// Netlify Function: upload.js
// Receives base64-encoded image from browser, uploads to HubSpot Files API
// Uses only Node.js built-ins — no npm packages required

const https = require('https');

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  try {
    const { base64, filename, mimeType } = JSON.parse(event.body || '{}');
    if (!base64 || !filename) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: 'Missing base64 or filename' }),
      };
    }

    const fileBuffer = Buffer.from(base64, 'base64');
    const boundary = '----FormBoundary' + Date.now().toString(16);
    const contentType = mimeType || 'image/jpeg';

    // Build multipart/form-data body manually
    const parts = [];

    // -- file field
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
    );
    parts.push(fileBuffer);
    parts.push('\r\n');

    // -- options field
    const optionsJson = JSON.stringify({
      access: 'PUBLIC_INDEXABLE',
      overwrite: false,
      duplicateValidationStrategy: 'NONE',
    });
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="options"\r\n\r\n` +
      `${optionsJson}\r\n`
    );

    // -- folderPath field (HubSpot will create the folder if it doesn't exist)
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="folderPath"\r\n\r\n` +
      `/befaringsrapporter\r\n`
    );

    // -- closing boundary
    parts.push(`--${boundary}--\r\n`);

    // Combine all parts into a single Buffer
    const bodyParts = parts.map(p =>
      typeof p === 'string' ? Buffer.from(p, 'utf8') : p
    );
    const bodyBuffer = Buffer.concat(bodyParts);

    // POST to HubSpot Files API
    const data = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.hubapi.com',
        path: '/files/v3/files',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': bodyBuffer.length,
        },
      }, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch (e) {
            resolve({ status: res.statusCode, body: { error: raw } });
          }
        });
      });
      req.on('error', reject);
      req.write(bodyBuffer);
      req.end();
    });

    if (data.status < 200 || data.status >= 300) {
      console.error('HubSpot Files API error:', data.status, JSON.stringify(data.body));
      return {
        statusCode: data.status,
        headers: cors,
        body: JSON.stringify({
          error: `HubSpot error ${data.status}`,
          message: data.body?.message || data.body?.error || JSON.stringify(data.body),
          detail: data.body,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ url: data.body.url, id: data.body.id }),
    };

  } catch (err) {
    console.error('upload.js exception:', err.message);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
