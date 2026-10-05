'use strict';
const crypto = require('node:crypto');
const SERVER_KEY = '04c5c00c4f8d1197cc7c3167c52bf7acb054d722f0ef08dcd7e0883236e0d72a3868d9750cb47fa4619248f3d83f0f662671dadc6e2d31c2f41db0161651c7c076';
class Cloud {
  constructor(credentials, session = null) {
    this.credentials = credentials;
    this.session = session;
    this.base = credentials.region === 'com' ? 'https://ankerpower-api.anker.com' : 'https://ankerpower-api-eu.anker.com';
  }
  async request(path, body = {}, authenticated = true, retry = true) {
    if (authenticated && (!this.session || this.session.token_expires_at * 1000 < Date.now() + 60000)) await this.login();
    const headers = { 'content-type': 'application/json', 'model-type': 'DESKTOP', 'app-name': 'anker_power', 'os-type': 'android', country: this.credentials.country || 'DE', timezone: 'GMT+00:00' };
    if (authenticated) Object.assign(headers, { 'x-auth-token': this.session.auth_token, gtoken: crypto.createHash('md5').update(this.session.user_id).digest('hex') });
    let response;
    try { response = await fetch(`${this.base}/${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error('Anker: connection failed'); }
    if (!response.ok) throw new Error(`Anker HTTP ${response.status}`);
    let result;
    try { result = await response.json(); } catch { throw new Error('Anker: invalid response'); }
    if (authenticated && retry && [401, 26084].includes(result.code)) { await this.login(); return this.request(path, body, true, false); }
    if (result.code !== 0) throw new Error(`Anker API ${Number(result.code) || 'error'}`);
    return result.data;
  }
  async login() {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this._login().finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }
  async _login() {
    const c = this.credentials;
    if (!c.email || !c.password || !['eu', 'com'].includes(c.region) || !/^[A-Z]{2}$/.test(c.country)) throw new Error('Enter email, password, region and two-letter country');
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const key = ecdh.computeSecret(Buffer.from(SERVER_KEY, 'hex'));
    const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
    const password = Buffer.concat([cipher.update(c.password, 'utf8'), cipher.final()]).toString('base64');
    const data = await this.request('passport/login', { ab: c.country, client_secret_info: { public_key: ecdh.getPublicKey('hex') }, enc: 0, email: c.email.trim(), password, time_zone: 0, transaction: String(Date.now()) }, false);
    if (!data?.auth_token || !data.user_id || !data.token_expires_at) throw new Error('Anker: incomplete login response');
    this.session = { auth_token: data.auth_token, user_id: data.user_id, token_expires_at: data.token_expires_at };
    return this.session;
  }
  async devices() {
    const data = await this.request('power_service/v1/app/get_relate_and_bind_devices');
    return (data?.data || []).filter(d => (d.product_code || d.device_pn) === 'A2345');
  }
  async theme(id) {
    const data=await this.request('mini_power/v1/app/style/get_clock_screensavers',{product_code:'A2345'});
    const theme=(data.category||[]).flatMap(c=>c.list||[]).find(t=>String(t.id)===String(id));
    if(!theme)throw new Error('Theme unavailable');
    return {id:Number(theme.id),hash:Number(theme.file_crc32),url:theme.image_url};
  }
  mqttInfo() { return this.request('app/devicemanage/get_user_mqtt_info'); }
}
module.exports = Cloud;
