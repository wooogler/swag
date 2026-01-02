import nodemailer from 'nodemailer';

interface SendMagicLinkParams {
  to: string;
  magicLink: string;
}

interface SendStudentVerificationParams {
  to: string;
  magicLink: string;
  studentName: string;
}

// Gmail SMTP transporter 설정
const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
};

export async function sendMagicLink({ to, magicLink }: SendMagicLinkParams) {
  const fromAddress = process.env.EMAIL_FROM || process.env.GMAIL_USER || 'SWAG';

  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: fromAddress,
      to,
      subject: 'Your SWAG Login Link',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
              <h1 style="color: #1a1a1a; margin: 0 0 20px 0; font-size: 24px;">SWAG Instructor Portal</h1>
              <p style="margin: 0 0 20px 0; font-size: 16px;">Click the button below to log in to your instructor account:</p>

              <a href="${magicLink}"
                 style="display: inline-block; background-color: #2563eb; color: white; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                Log In to SWAG
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
              <strong>SWAG</strong> - Student Writing with Accountable Generative AI<br>
              Virginia Tech
            </p>
          </body>
        </html>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send email via Gmail:', error);
    throw new Error('Failed to send login link');
  }
}

export async function sendStudentVerificationEmail({ to, magicLink, studentName }: SendStudentVerificationParams) {
  const fromAddress = process.env.EMAIL_FROM || process.env.GMAIL_USER || 'SWAG';

  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: fromAddress,
      to,
      subject: 'Verify Your Email for SWAG Assignment',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
              <h1 style="color: #1a1a1a; margin: 0 0 20px 0; font-size: 24px;">SWAG - Email Verification</h1>
              <p style="margin: 0 0 10px 0; font-size: 16px;">Hi ${studentName},</p>
              <p style="margin: 0 0 20px 0; font-size: 16px;">Click the button below to verify your email and access your assignment:</p>

              <a href="${magicLink}"
                 style="display: inline-block; background-color: #10b981; color: white; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                Verify Email & Continue
              </a>

              <p style="margin: 20px 0 0 0; font-size: 14px; color: #666;">
                Or copy and paste this link into your browser:<br>
                <a href="${magicLink}" style="color: #10b981; word-break: break-all;">${magicLink}</a>
              </p>
            </div>

            <div style="font-size: 14px; color: #666;">
              <p style="margin: 0 0 10px 0;">This link will expire in 15 minutes.</p>
              <p style="margin: 0;">If you didn't request access to this assignment, you can safely ignore this email.</p>
            </div>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">

            <p style="font-size: 12px; color: #999; margin: 0;">
              <strong>SWAG</strong> - Student Writing with Accountable Generative AI<br>
              Virginia Tech
            </p>
          </body>
        </html>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send student verification email via Gmail:', error);
    throw new Error('Failed to send verification email');
  }
}

