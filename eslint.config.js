import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const NO_PHASER = {
  paths: [
    {
      name: 'phaser',
      message:
        'Phaser may only be imported from src/game/. Simulation, networking, room and config code must stay renderer-agnostic (spec §37).',
    },
  ],
};

const NO_RAW_WEBRTC = [
  {
    name: 'RTCPeerConnection',
    message:
      'Raw WebRTC APIs are only allowed in src/networking/transport/. Use the Transport interface instead (spec §7, §37).',
  },
  {
    name: 'RTCDataChannel',
    message:
      'Raw WebRTC APIs are only allowed in src/networking/transport/. Use the Transport interface instead (spec §7, §37).',
  },
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // Everything except the game layer must stay free of Phaser.
    files: ['src/**/*.ts'],
    ignores: ['src/game/**', 'src/main.ts'],
    rules: {
      'no-restricted-imports': ['error', NO_PHASER],
    },
  },
  {
    // Everything except the transport layer must stay free of raw WebRTC.
    files: ['src/**/*.ts', 'server/**/*.ts'],
    ignores: ['src/networking/transport/**'],
    rules: {
      'no-restricted-globals': ['error', ...NO_RAW_WEBRTC],
    },
  },
  {
    files: ['server/**/*.ts', 'tests/**/*.ts', '*.config.ts', 'eslint.config.js'],
    rules: {
      'no-console': 'off',
    },
  },
);
