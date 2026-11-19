jest.mock('../utils/historyStore', () => ({ readUserHistory: jest.fn(), clearUserHistory: jest.fn() }));

const aliases = require('../commands/aliases');
const history = require('../utils/historyStore');

afterEach(() => jest.clearAllMocks());

test('/his registers show/clear subcommands and clears the requesting user history', async () => {
    const options = aliases.his.data.toJSON().options;
    expect(options.map(option => option.name)).toEqual(['show', 'clear']);
    expect(options[0].options[0]).toMatchObject({ name: 'limit', min_value: 1, max_value: 20 });
    history.clearUserHistory.mockResolvedValue(true);
    const request = { options: { getSubcommand: () => 'clear' }, user: { id: '123' }, reply: jest.fn() };
    await aliases.his.execute(request);
    expect(history.clearUserHistory).toHaveBeenCalledWith('123');
    expect(request.reply).toHaveBeenCalledWith('🗑️ Đã xóa lịch sử nhạc!');
});

test('Discord validates volume and loop alias input like the full commands', () => {
    expect(aliases.v.data.toJSON().options[0]).toMatchObject({
        name: 'level', required: true, min_value: 0, max_value: 100
    });
    expect(aliases.lp.data.toJSON().options[0].choices.map(choice => choice.value)).toEqual(['off', 'track', 'queue']);
});
