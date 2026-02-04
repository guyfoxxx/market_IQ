export type TgReplyMarkup = Record<string, any> | undefined;

export class Telegram {
  constructor(private token: string) {}

  private api(method: string) {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  async callJson(method: string, payload: any) {
    const res = await fetch(this.api(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as any;
    if (!data?.ok) throw new Error(`Telegram API error: ${method} -> ${JSON.stringify(data)}`);
    return data.result;
  }

  async callForm(method: string, form: FormData) {
    const res = await fetch(this.api(method), { method: 'POST', body: form });
    const data = (await res.json()) as any;
    if (!data?.ok) throw new Error(`Telegram API error: ${method} -> ${JSON.stringify(data)}`);
    return data.result;
  }

  sendMessage(chat_id: number, text: string, opts: { reply_markup?: TgReplyMarkup; parse_mode?: 'HTML' | 'MarkdownV2'; disable_web_page_preview?: boolean } = {}) {
    return this.callJson('sendMessage', {
      chat_id,
      text,
      parse_mode: opts.parse_mode ?? 'HTML',
      disable_web_page_preview: opts.disable_web_page_preview ?? true,
      reply_markup: opts.reply_markup,
    });
  }

  editMessageText(chat_id: number, message_id: number, text: string, opts: { reply_markup?: TgReplyMarkup; parse_mode?: 'HTML' | 'MarkdownV2' } = {}) {
    return this.callJson('editMessageText', {
      chat_id,
      message_id,
      text,
      parse_mode: opts.parse_mode ?? 'HTML',
      reply_markup: opts.reply_markup,
    });
  }

  answerCallbackQuery(callback_query_id: string, text?: string) {
    return this.callJson('answerCallbackQuery', {
      callback_query_id,
      text,
      show_alert: false,
    });
  }

  async sendPhoto(chat_id: number, photoBytes: ArrayBuffer, caption?: string, opts: { reply_markup?: TgReplyMarkup; parse_mode?: 'HTML' | 'MarkdownV2' } = {}) {
    const form = new FormData();
    form.append('chat_id', chat_id.toString());
    if (caption) form.append('caption', caption);
    form.append('parse_mode', opts.parse_mode ?? 'HTML');
    if (opts.reply_markup) form.append('reply_markup', JSON.stringify(opts.reply_markup));
    const blob = new Blob([photoBytes], { type: 'image/png' });
    form.append('photo', blob, 'chart.png');
    return this.callForm('sendPhoto', form);
  }

  getMe() {
    return this.callJson('getMe', {});
  }

  setWebhook(url: string, secret_token?: string) {
    return this.callJson('setWebhook', { url, secret_token });
  }
}
