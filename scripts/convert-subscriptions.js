#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const INPUT_DIR = path.resolve('subscriptions');
const OUTPUT_DIR = path.resolve('mihomo');

const files = ['all.yaml', 'google.yaml', 'stable.yaml', 'best.yaml', 'country.yaml'];

function loadProxies(file) {
  const text = fs.readFileSync(path.join(INPUT_DIR, file), 'utf8');
  const doc = yaml.load(text);
  if (!doc || !Array.isArray(doc.proxies)) {
    throw new Error(`${file}: expected a YAML document with a proxies array`);
  }

  // Round-trip every generated subscription through js-yaml. This catches
  // malformed YAML before it is exposed as an import URL.
  const normalized = yaml.load(
    yaml.dump({ proxies: doc.proxies }, {
      lineWidth: -1,
      noRefs: true,
      forceQuotes: true,
      quotingType: "'"
    })
  );

  return normalized.proxies.filter(p => p && typeof p === 'object' && p.name);
}

function buildConfig(proxies, file) {
  const names = proxies.map(p => String(p.name));

  if (file === 'country.yaml') {
    const targets = {
      US: 'United States', JP: 'Japan', KR: 'South Korea', SG: 'Singapore',
      GB: 'United Kingdom', DE: 'Germany', FR: 'France', NL: 'Netherlands',
      CA: 'Canada', AU: 'Australia', IN: 'India', TW: 'Taiwan', HK: 'Hong Kong'
    };
    const groups = [];
    const countryNames = [];

    function countryCode(name) {
      const text = String(name || '');

      // Prefer the explicit ISO marker used by generated node names, e.g. US_12.
      const iso = text.match(/(?:^|[^A-Za-z])([A-Z]{2})_\d+(?:\||$)/);
      if (iso && targets[iso[1]]) return iso[1];

      // Fall back to Unicode regional-indicator pairs without relying on a
      // regex Unicode code-point range (which is easy to over-escape in YAML/JS).
      const chars = [...text];
      for (let i = 0; i < chars.length - 1; i++) {
        const a = chars[i].codePointAt(0);
        const b = chars[i + 1].codePointAt(0);
        if (a >= 0x1F1E6 && a <= 0x1F1FF && b >= 0x1F1E6 && b <= 0x1F1FF) {
          const code = String.fromCharCode(a - 0x1F1E6 + 65) +
            String.fromCharCode(b - 0x1F1E6 + 65);
          if (targets[code]) return code;
        }
      }

      return null;
    }

    for (const [code, label] of Object.entries(targets)) {
      const nodes = proxies.filter(p => countryCode(p.name) === code).map(p => String(p.name));
      if (!nodes.length) continue;
      const groupName = code + ' · ' + label;
      countryNames.push(groupName);
      groups.push({
        name: groupName,
        type: 'url-test',
        url: 'https://www.google.com/generate_204',
        interval: 300,
        tolerance: 100,
        lazy: false,
        proxies: nodes
      });
    }

    return {
      'mixed-port': 7890,
      'allow-lan': false,
      mode: 'rule',
      'log-level': 'warning',
      ipv6: false,
      proxies,
      'proxy-groups': [
        {
          name: 'COUNTRY',
          type: 'select',
          proxies: ['DIRECT', ...countryNames]
        },
        ...groups
      ],
      rules: ['MATCH,COUNTRY']
    };
  }

  return {
    'mixed-port': 7890,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'warning',
    ipv6: false,
    proxies,
    'proxy-groups': [
      {
        name: 'PROXY',
        type: 'select',
        proxies: ['DIRECT', ...names]
      }
    ],
    rules: ['MATCH,PROXY']
  };
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

for (const file of files) {
  const proxies = loadProxies(file);
  const config = buildConfig(proxies, file);
  const output = path.join(OUTPUT_DIR, file);

  fs.writeFileSync(
    output,
    yaml.dump(config, {
      lineWidth: -1,
      noRefs: true,
      forceQuotes: true,
      quotingType: "'"
    }),
    'utf8'
  );

  console.log(`${file} -> ${output} (${proxies.length} nodes)`);
}

// best.yaml is the convenient default for clients that expect one config.
fs.copyFileSync(
  path.join(OUTPUT_DIR, 'best.yaml'),
  path.join(OUTPUT_DIR, 'config.yaml')
);
