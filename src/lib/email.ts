import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

interface SendMagicLinkParams {
  to: string;
  magicLink: string;
}

export async function sendMagicLink({ to, magicLink }: SendMagicLinkParams) {
  const fromAddress = process.env.EMAIL_FROM || 'PRELUDE <onboarding@resend.dev>';

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to,
      subject: 'Your PRELUDE Login Link',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
              <h1 style="color: #1a1a1a; margin: 0 0 20px 0; font-size: 24px;">PRELUDE Instructor Portal</h1>
              <p style="margin: 0 0 20px 0; font-size: 16px;">Click the button below to log in to your instructor account:</p>

              <a href="${magicLink}"
                 style="display: inline-block; background-color: #2563eb; color: white; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                Log In to PRELUDE
              </a>

              <p style="margin: 20px 0 0 0; font-size: 14px; color: #666;">
                Or copy and paste this link into your browser:<br>
                <a href="${magicLink}" style="color: #2563eb; word-break: break-all;">${magicLink}</a>
              </p>
            </div>

            <div style="font-size: 14px; color: #666;">
              <p style="margin: 0 0 10px 0;">This link will expire in 15 minutes.</p>
              <p style="margin: 0;">If you didn't request this login link, you can safely ignore this email.</p>
            </div>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">

            <p style="font-size: 12px; color: #999; margin: 0;">
              <strong>PRELUDE</strong> - Process and Replay for LLM Usage and Drafting Events<br>
              Virginia Tech
            </p>
          </body>
        </html>
      `,
    });

    if (error) {
      throw error;
    }

    return { success: true, messageId: data?.id };
  } catch (error) {
    console.error('Failed to send email via Resend:', error);
    throw new Error('Failed to send login link');
  }
}
