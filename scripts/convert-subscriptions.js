#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const INPUT_DIR = path.resolve('subscriptions');
const OUTPUT_DIR = path.resolve('mihomo');

const files = ['all.yaml', 'google.yaml', 'stable.yaml', 'best.yaml'];

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

function buildConfig(proxies) {
  const names = proxies.map(p => String(p.name));

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
    rules: [
      'MATCH,PROXY'
    ]
  };
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

for (const file of files) {
  const proxies = loadProxies(file);
  const config = buildConfig(proxies);
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
