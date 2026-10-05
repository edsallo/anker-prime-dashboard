'use strict';
// A2345 wire format researched by thomluther/anker-solix-api (MIT); see THIRD_PARTY.md.
const PORTS = ['C1', 'C2', 'C3', 'C4', 'A1', 'A2'];
const GROUPS = ['C1', 'C2', 'C3', 'C4', 'A'];
function integer(n, min, max) { if (!Number.isInteger(n) || n < min || n > max) throw new Error('Invalid value'); return n; }
function field(tag, value, type = 1) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from([value]);
  return Buffer.concat([Buffer.from([tag, data.length + 1, type]), data]);
}
function packet(type, fields = [], timestamp = Math.floor(Date.now() / 1000)) {
  const stamp = Buffer.alloc(4); stamp.writeUInt32LE(timestamp);
  const body = Buffer.concat([Buffer.from('a10122', 'hex'), ...fields, field(0xfe, stamp, 3)]);
  const header = Buffer.from(`ff09000003000f${type}`, 'hex');
  header.writeUInt16LE(header.length + body.length + 1, 2);
  const data = Buffer.concat([header, body]);
  return Buffer.concat([data, Buffer.from([data.reduce((a, b) => a ^ b, 0)])]);
}
function command(action, args = {}, timestamp) {
  const selected = () => { const i = GROUPS.indexOf(args.port); if (i < 0) throw new Error('Unknown port'); return field(0xa2, i); };
  const boolean = v => { if (typeof v !== 'boolean') throw new Error('Expected boolean'); return Number(v); };
  let type, fields = [];
  switch (action) {
    case 'status': type = '0200'; break;
    case 'realtime': type = '020b'; break;
    case 'power': type = '0207'; fields = [selected(), field(0xa3, boolean(args.on))]; break;
    case 'timer': {
      const minutes = integer(args.minutes, 0, 1435); if (minutes % 5) throw new Error('Timer uses 5 minute steps');
      const data = Buffer.alloc(5); data[0] = minutes > 0 ? 1 : 0; data.writeUInt32LE(minutes * 60, 1);
      type = '0209'; fields = [selected(), field(0xa3, data, 4)]; break;
    }
    case 'schedule': {
      if (!['start', 'end'].includes(args.kind)) throw new Error('Unknown schedule');
      const data = Buffer.from([boolean(args.enabled), integer(args.hour, 0, 23), integer(args.minute, 0, 59), integer(args.weekdays, 0, 127)]);
      if (args.enabled && !args.weekdays) throw new Error('Select weekdays');
      type = '0208'; fields = [selected(), field(0xa3, args.kind === 'start' ? 1 : 0), field(0xa4, data, 3)]; break;
    }
    case 'custom': {
      if(!Array.isArray(args.profile)||args.profile.length!==7||!Array.isArray(args.protocols)||args.protocols.length!==12)throw new Error('Incomplete custom profile');
      args.profile.forEach(n=>integer(n,0,255));args.protocols.forEach(n=>integer(n,0,255));
      if(args.profile[1]>1||args.profile.slice(2).some((n,i)=>n>[140,100,100,100,24][i])||args.profile.slice(2).reduce((a,b)=>a+b,0)>250)throw new Error('Invalid custom budget');
      type='0206';fields=[field(0xa2,5),field(0xa3,Buffer.from(args.profile),4),field(0xa4,Buffer.from(args.protocols),4)];break;
    }
    case 'mode': type = '0206'; fields = [field(0xa2, integer(args.value, 1, 4))]; break;
    case 'clock_holiday': type='020f';fields=[field(0xa2,boolean(args.enabled))];break;
    case 'clock_schedule': type='0213';fields=[field(0xa2,Buffer.from([integer(args.startHour,0,23),integer(args.startMinute,0,59),integer(args.endHour,0,23),integer(args.endMinute,0,59),integer(args.weekdays,0,127)]),4)];break;
    case 'theme': {
      const id=Buffer.alloc(4),hash=Buffer.alloc(4);id.writeUInt32LE(integer(args.id,0,0xffffffff));hash.writeUInt32LE(integer(args.hash,0,0xffffffff));
      const url=new URL(args.url);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Invalid theme URL');
      const bytes=Buffer.from(args.url,'utf8');if(bytes.length>254)throw new Error('Theme URL too long');
      const clock=integer(args.clockSettings??0,0,255);
      type='0205';fields=[field(0xa2,(clock&~6)|2),field(0xa3,id,3),field(0xa4,hash,3),field(0xa5,Buffer.from('ffffffff','hex'),3),field(0xa6,bytes,4)];break;
    }
    case 'brightness': type = '0204'; integer(args.value, 20, 100); if (args.value % 5) throw new Error('Brightness uses steps of 5'); fields = [field(0xa2, args.value)]; break;
    case 'timeout': type = '0203'; fields = [field(0xa2, integer(args.value, 0, 4))]; break;
    case 'clock': type = '0210'; fields = [field(0xa2, integer(args.value, 0, 1))]; break;
    case 'knob': type = '020e'; fields = [field(0xa2, integer(args.value, 0, 1))]; break;
    case 'priority': type = '020c'; if (![0,1,2,3,4,5,6,8,9,10,12].includes(args.value)) throw new Error('Select at most two USB-C ports'); fields = [field(0xa2, args.value)]; break;
    default: throw new Error('Unsupported action');
  }
  return packet(type, fields, timestamp);
}
function decode(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 13 || buffer.subarray(0,2).toString('hex') !== 'ff09' || buffer.readUInt16LE(2) !== buffer.length || buffer.reduce((a,b) => a ^ b, 0) !== 0) throw new Error('Invalid MQTT frame');
  const type = buffer.subarray(7,9).toString('hex'), fields = {};
  let i = buffer[9] >= 0xa0 && buffer[9] <= 0xa9 ? 9 : 10;
  while (i < buffer.length - 1) {
    const tag = buffer[i++], length = buffer[i++];
    if (!length || i + length > buffer.length - 1) throw new Error('Truncated MQTT field');
    const raw = buffer.subarray(i, i + length); i += length;
    fields[tag] = raw.length > 1 && raw[0] < 0x31 ? raw.subarray(1) : raw;
  }
  const state = { ports: {}, groups: {}, settings: {} };
  if (['0303', '0a00'].includes(type)) {
    PORTS.forEach((port, index) => {
      const f = fields[(type === '0303' ? 0xa2 : 0xa4) + index];
      if (f?.length >= 7) state.ports[port] = { active: !!f[0], voltage: f.readInt16LE(1) / 1000, current: f.readInt16LE(3) / 1000, power: f.readInt16LE(5) / 100 };
    });
  }
  if (type === '0a00') {
    state.settings.customProfile=fields[0xb8]?.length===7?[...fields[0xb8]]:null;
    state.settings.customProtocols=fields[0xba]?.length===12?[...fields[0xba]]:null;
    GROUPS.forEach((port, index) => {
      const f = fields[0xaa + index];
      if (f?.length >= 19) state.groups[port] = { on: !!f[0], start: { enabled: f[1] === 1, hour:f[2], minute:f[3], weekdays:f[4] }, end: { enabled:f[5] === 1, hour:f[6], minute:f[7], weekdays:f[8] }, timerEnabled: !!f[9], timerSeconds:f.readUInt32LE(10), remaining:f.readUInt32LE(14), priority:f[18] };
    });
    if(fields[0xb9]?.length>=5){const f=fields[0xb9];if(f[0]<24&&f[1]<60&&f[2]<24&&f[3]<60&&f[4]<128)state.settings.clockSchedule={startHour:f[0],startMinute:f[1],endHour:f[2],endMinute:f[3],weekdays:f[4]};}
    if(fields[0xaf]?.length>=5){state.settings.clockSettings=fields[0xaf][0];state.settings.themeId=fields[0xaf].readUInt32LE(1);}
    for (const [tag, name] of [[0xb0,'timeout'],[0xb1,'mode'],[0xb3,'brightness'],[0xb4,'knob'],[0xb5,'clock']]) if (fields[tag]?.length) state.settings[name] = fields[tag][0];
  }
  if (type === '0302' && fields[0xa2]?.length && fields[0xa3]?.length) {
    const port = GROUPS[fields[0xa2][0]]; if (port) state.groups[port] = { on: !!fields[0xa3][0] };
  }
  return { type, state };
}
module.exports = { command, packet, field, decode, PORTS, GROUPS };
