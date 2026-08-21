import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchHtml } from './http.js';

const execFileAsync = promisify(execFile);

export async function fetchOfficialMarkdown(url) {
  const target = new URL(url);
  const proxyUrl = `https://r.jina.ai/http://${target.host}${target.pathname}${target.search}`;
  try {
    return await fetchHtml(proxyUrl);
  } catch (fetchError) {
    const { stdout } = await execFileAsync('curl', ['-fsSL', '--max-time', '60', proxyUrl], {
      maxBuffer: 8 * 1024 * 1024
    });
    if (!stdout || /Target URL returned error|403 ERROR/.test(stdout)) throw fetchError;
    return stdout;
  }
}
