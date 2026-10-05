'use strict';
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const mqtt = require('mqtt');
const { command, decode, PORTS } = require('./protocol');
class Connection extends EventEmitter {
  constructor(info, devices) {
    super(); this.info = info; this.devices = devices; this.states = new Map(); this.queues = new Map(); this.closed = false;
  }
  async connect() {
    const info = this.info;
    if (!/^[a-z0-9.-]+\.anker\.com$/i.test(info.endpoint_addr || '')) throw new Error('Invalid Anker MQTT host');
    this.client = mqtt.connect(`mqtts://${info.endpoint_addr}:8883`, { clientId: `${info.thing_name}_${crypto.randomInt(10000,99999)}`, cert:info.certificate_pem, key:info.private_key, ca:info.aws_root_ca1_pem, rejectUnauthorized:true, clean:true, connectTimeout:15000, reconnectPeriod:10000, queueQoSZero:false });
    this.client.on('error', () => this.emit('connectionError', 'MQTT connection failed'));
    this.client.on('offline', () => this.emit('offline'));
    this.client.on('message', (topic, bytes) => this.receive(topic, bytes));
    this.client.on('connect', async () => {
      try {
        for (const d of this.devices) {
          await this.client.subscribeAsync(`dt/${info.app_name}/A2345/${d.device_sn}/#`);
          await this.send(d.device_sn, 'status');
          await this.send(d.device_sn, 'realtime');
        }
        this.emit('online');
      } catch { this.emit('connectionError', 'MQTT subscribe failed'); }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('MQTT connection timeout')), 20000);
      const ready = () => finish();
      const finish = error => { clearTimeout(timer); this.removeListener('online', ready); error ? reject(error) : resolve(); };
      this.once('online', ready);
    });
    this.tick = setInterval(() => {
      if (!this.client.connected) return;
      for (const d of this.devices) this.send(d.device_sn, 'realtime').catch(() => {});
    }, 8000);
    this.poll = setInterval(() => {
      if (!this.client.connected) return;
      for (const d of this.devices) this.send(d.device_sn, 'status').catch(() => {});
    }, 30000);
  }
  receive(topic, bytes) {
    try {
      const sn = topic.split('/')[3];
      if (!this.devices.some(d => d.device_sn === sn)) return;
      const outer = JSON.parse(bytes.toString());
      const payload = typeof outer.payload === 'string' ? JSON.parse(outer.payload) : outer.payload;
      if (!payload?.data) return;
      const frame = Buffer.from(payload.data, 'base64');
      const { type, state: patch } = decode(frame);
      if (!['0a00','0303','0302'].includes(type)) return;
      const now = Date.now();
      const state = this.states.get(sn) || { ports:{}, groups:{}, settings:{}, updated:0, statusUpdated:0 };
      for (const [port, value] of Object.entries(patch.ports)) state.ports[port] = { ...value, updated:now };
      for (const [group, value] of Object.entries(patch.groups)) state.groups[group] = { ...state.groups[group], ...value };
      Object.assign(state.settings, patch.settings);
      if (patch.firmware) state.firmware = patch.firmware;
      state.updated = now;
      if (type === '0a00') state.statusUpdated = now;
      state.total = PORTS.every(p => state.ports[p] && now - state.ports[p].updated < 45000) ? PORTS.reduce((sum,p) => sum + state.ports[p].power,0) : null;
      this.states.set(sn, state);
      this.emit('state', sn, structuredClone(state));
    } catch { this.emit('invalidFrame'); }
  }
  async send(sn, action, args = {}) {
    if (this.closed || !this.client?.connected) throw new Error('Anker is offline');
    if (!this.devices.some(d => d.device_sn === sn)) throw new Error('Unknown device');
    const info = this.info;
    const envelope = { head: { version:'1.0.0.1', client_id:`android-${info.app_name}-${info.user_id}-${info.certificate_id}`, sess_id:'1234-5678', msg_seq:1, seed:1, timestamp:Math.floor(Date.now()/1000), cmd_status:2, cmd:17, sign_code:1, device_pn:'A2345', device_sn:sn }, payload:JSON.stringify({ device_sn:sn, account_id:info.user_id, data:command(action,args).toString('base64') }) };
    await this.client.publishAsync(`cmd/${info.app_name}/A2345/${sn}/req`, JSON.stringify(envelope), { qos:0, retain:false });
  }
  async control(sn, action, args) {
    const custom=action==='limit'||action==='mode'&&args.value===5;
    if(action==='limit')require('./power-limit').validate(args.port,args.value);
    else if(!custom)command(action,args); // Validate before joining the queue.
    if (['status','realtime'].includes(action)) throw new Error('Unsupported control');
    const queuedAt = Date.now();
    const previous = this.queues.get(sn) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      if (Date.now()-queuedAt > 15000) throw new Error('Command expired in queue');
      let state = this.states.get(sn);
      if (custom || !state || Date.now() - state.statusUpdated > 45000) {
        const requested=Date.now();const wait = this.waitFor(sn, s => s.statusUpdated >= requested);
        wait.catch(() => {}); try { await this.send(sn,'status'); await wait; } finally { wait.cancel(); } state = this.states.get(sn);
      }
      if(action==='theme'){
        if(!Number.isInteger(state?.settings.clockSettings))throw new Error('Clock state unavailable');
        args={...args,clockSettings:state.settings.clockSettings};
      }
      if(custom){
        args=require('./power-limit').prepare(state?.settings,args,action==='limit');action='custom';
      }
      const sent = Date.now();
      const wait = this.waitFor(sn, s => s.statusUpdated >= sent && this.matches(s,action,args));
      wait.catch(() => {});
      const poll = setInterval(() => this.send(sn,'status').catch(() => {}), 2000);
      try { await this.send(sn,action,args); await this.send(sn,'status'); return await wait; }
      finally { clearInterval(poll); wait.cancel(); }
    });
    this.queues.set(sn,current); current.finally(() => { if (this.queues.get(sn) === current) this.queues.delete(sn); }).catch(() => {});
    return current;
  }
  matches(s, action, a) {
    const g = s.groups?.[a.port];
    if(action==='custom')return s.settings.mode===5&&['profile','protocols'].every(k=>{const values=s.settings[k==='profile'?'customProfile':'customProtocols'];return Array.isArray(values)&&values.length===a[k].length&&values.every((v,i)=>v===a[k][i]);});
    if (action === 'clock_holiday') return Number.isInteger(s.settings.clockSettings)&&Boolean(s.settings.clockSettings&64)===a.enabled;
    if (action === 'clock_schedule') return s.settings.clockSchedule&&['startHour','startMinute','endHour','endMinute','weekdays'].every(k=>s.settings.clockSchedule[k]===a[k]);
    if (action === 'theme') return s.settings.themeId===a.id&&(s.settings.clockSettings&6)===2;
    if (action === 'power') return g?.on === a.on;
    if (action === 'timer') return g?.timerEnabled === (a.minutes > 0) && (!a.minutes || g.timerSeconds === a.minutes * 60);
    if (action === 'schedule') return g?.[a.kind] && Object.entries({enabled:a.enabled,hour:a.hour,minute:a.minute,weekdays:a.weekdays}).every(([k,v]) => g[a.kind][k] === v);
    if (action === 'priority') return ['C1','C2','C3','C4'].every((p,i) => s.groups[p]?.priority === (a.value & (1 << i) ? 2 : 1));
    return s.settings[action] === a.value;
  }
  waitFor(sn, predicate, timeout = 12000) {
    let cancel;
    const promise = new Promise((resolve,reject) => {
      const done = (error, state) => { clearTimeout(timer); this.removeListener('state', listener); error ? reject(error) : resolve(state); };
      const listener = (id,state) => { if (id === sn && predicate(state)) done(null,state); };
      const timer = setTimeout(() => done(new Error('No confirmation from charger')),timeout);
      this.on('state',listener);
      cancel=()=>done(new Error('Confirmation cancelled'));
    });
    promise.cancel=cancel;return promise;
  }
  async close() { this.closed = true; clearInterval(this.tick); clearInterval(this.poll); if (this.client) await this.client.endAsync(true); }
}
module.exports = Connection;
