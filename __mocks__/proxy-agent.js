// Manual mock for proxy-agent.
// proxy-agent v8 is ESM-only, which Jest's CommonJS runtime cannot load
// directly; this mock keeps the constructor-call assertions working.
const ProxyAgent = jest.fn();

module.exports = { ProxyAgent };
