import fetch from 'node-fetch';

const WEBHOOK = 'https://discord.com/api/webhooks/1371462804/5WST7HMwu2XHIR2_AMUYKY3TBF6UD5MX9EefB6yTigE8fjw2Q88vjpiERhRvCUo6T6IO';

export async function notify(message) {
  await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message })
  });
}
