const dryRun = process.env.DRY_RUN === '1';
const requireTargets = process.env.REQUIRE_TARGETS === '1';
const errors = [];
const warnings = [];

function requireEnv(name, reason) {
  if (!process.env[name]) errors.push(`${name} is required: ${reason}`);
}

function warnEnv(name, reason) {
  if (!process.env[name]) warnings.push(`${name} is not set: ${reason}`);
}

if (!dryRun && requireTargets) {
  requireEnv('DISCORD_WEBHOOK_URL', 'needed to post the Discord digest');
  requireEnv('GOOGLE_SHEET_ID', 'needed to update Google Sheets');
  requireEnv('GOOGLE_SERVICE_ACCOUNT_JSON', 'needed to authenticate Google Sheets API');
}

if (!dryRun && !requireTargets) {
  warnEnv('DISCORD_WEBHOOK_URL', 'Discord posting will be skipped');
  warnEnv('GOOGLE_SHEET_ID', 'Google Sheets writing will be skipped');
}

if (process.env.GOOGLE_SHEET_ID && !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  errors.push('GOOGLE_SERVICE_ACCOUNT_JSON is required when GOOGLE_SHEET_ID is set.');
}

if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  try {
    const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    if (!parsed.client_email || !parsed.private_key) {
      errors.push('GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key.');
    }
  } catch {
    errors.push('GOOGLE_SERVICE_ACCOUNT_JSON must be valid single-line JSON.');
  }
}

for (const warning of warnings) console.warn(`⚠️ ${warning}`);

if (errors.length) {
  console.error('Deployment environment validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`✅ Environment validation passed (${dryRun ? 'dry-run' : 'production'} mode)`);
