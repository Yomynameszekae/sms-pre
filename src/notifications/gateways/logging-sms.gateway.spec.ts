import {
  LoggingSmsGateway,
  SANDBOX_TERMINAL_FAILURE_NUMBER,
  SANDBOX_RETRYABLE_FAILURE_NUMBER,
} from './logging-sms.gateway';

/**
 * The sandbox adapter. It exists so the whole path — consent gate,
 * normalisation, outbox, poller, retry, log — is exercisable without a vendor
 * account, an NCA-registered sender ID, or spending money.
 */
describe('LoggingSmsGateway', () => {
  const gateway = new LoggingSmsGateway();
  const msg = (id: string, to = '+233244123456') => ({ id, to, body: 'hello' });

  it('identifies itself, so a row records which gateway took it', () => {
    expect(gateway.code).toBe('sandbox');
  });

  it('accepts a message and returns a synthetic provider id', async () => {
    const [outcome] = await gateway.send([msg('n1')]);
    expect(outcome.status).toBe('accepted');
    if (outcome.status === 'accepted') {
      expect(outcome.providerMessageId).toMatch(/^sandbox-/);
    }
  });

  it('returns one outcome PER MESSAGE, matched by id and not by order', async () => {
    const outcomes = await gateway.send([msg('a'), msg('b'), msg('c')]);
    expect(outcomes.map((o) => o.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('sends nothing and costs nothing — there is no network call to make', async () => {
    // The whole point: a stakeholder demo exercises delivery without a bill.
    await expect(gateway.send([msg('n1')])).resolves.toBeDefined();
  });

  it('classifies the magic terminal number as terminal', async () => {
    const [outcome] = await gateway.send([msg('n1', SANDBOX_TERMINAL_FAILURE_NUMBER)]);
    expect(outcome.status).toBe('terminal_failure');
  });

  it('classifies the magic retryable number as retryable', async () => {
    const [outcome] = await gateway.send([msg('n1', SANDBOX_RETRYABLE_FAILURE_NUMBER)]);
    expect(outcome.status).toBe('retryable_failure');
  });

  it('a partly-failing batch reports each message separately', async () => {
    const outcomes = await gateway.send([
      msg('ok'),
      msg('bad', SANDBOX_TERMINAL_FAILURE_NUMBER),
      msg('slow', SANDBOX_RETRYABLE_FAILURE_NUMBER),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual([
      'accepted', 'terminal_failure', 'retryable_failure',
    ]);
  });

  it('an empty batch is not an error', async () => {
    expect(await gateway.send([])).toEqual([]);
  });

  it('never claims `delivered` — the sandbox cannot know what a handset did', async () => {
    const statuses = await gateway.fetchStatus(['sandbox-1', 'sandbox-2']);
    // Inventing a delivery confirmation would be inventing a fact. Rows stay
    // at `sent`, which is exactly what an acceptance-only gateway produces.
    expect(statuses.every((s) => s.status === 'unknown')).toBe(true);
  });
});
