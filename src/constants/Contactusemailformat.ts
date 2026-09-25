import config from '../configs/config';

export const contactUsConfirmationEmailFormat = (name: string) => {
  return `<!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <title>We Received Your Inquiry</title>
        <style media="all" type="text/css">
          @media only screen and (max-width: 640px) {
            .main p,
            .main td,
            .main span {
              font-size: 15px !important;
            }
            .wrapper {
              padding: 24px !important;
            }
            .container {
              width: 100% !important;
            }
            .main {
              border-radius: 0 !important;
            }
          }
          @media all {
            .ExternalClass {
              width: 100%;
            }
            .ExternalClass,
            .ExternalClass p,
            .ExternalClass span,
            .ExternalClass font,
            .ExternalClass td,
            .ExternalClass div {
              line-height: 100%;
            }
            .apple-link a {
              color: inherit !important;
              font-family: inherit !important;
              font-size: inherit !important;
              font-weight: inherit !important;
              line-height: inherit !important;
              text-decoration: none !important;
            }
            #MessageViewBody a {
              color: inherit;
              text-decoration: none;
              font-size: inherit;
              font-family: inherit;
              font-weight: inherit;
              line-height: inherit;
            }
          }
        </style>
      </head>
      <body
        style="
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          font-size: 16px;
          line-height: 1.5;
          -ms-text-size-adjust: 100%;
          -webkit-text-size-adjust: 100%;
          background-color: #f4f5f7;
          margin: 0;
          padding: 0;
        "
      >
        <span
          style="
            color: transparent;
            display: none;
            height: 0;
            max-height: 0;
            max-width: 0;
            opacity: 0;
            overflow: hidden;
            mso-hide: all;
            visibility: hidden;
            width: 0;
          "
          >We've received your inquiry and will be in touch shortly.</span
        >

        <table
          role="presentation"
          border="0"
          cellpadding="0"
          cellspacing="0"
          width="100%"
          bgcolor="#f4f5f7"
          style="border-collapse: collapse; width: 100%; background-color: #f4f5f7;"
        >
          <tr>
            <td align="center" style="padding: 40px 16px;">
              <table
                role="presentation"
                border="0"
                cellpadding="0"
                cellspacing="0"
                width="600"
                class="container"
                style="border-collapse: collapse; width: 600px; max-width: 600px;"
              >
                <tr>
                  <td align="center" style="padding-bottom: 20px;">
                    <p
                      style="
                        margin: 0;
                        font-size: 15px;
                        font-weight: 700;
                        letter-spacing: 0.5px;
                        color: #101b2d;
                        text-transform: uppercase;
                      "
                    >
                      ${config.essentials.appName}
                    </p>
                  </td>
                </tr>

                <tr>
                  <td
                    class="main"
                    style="
                      background-color: #ffffff;
                      border: 1px solid #eaebed;
                      border-radius: 12px;
                      overflow: hidden;
                    "
                  >
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; width: 100%;">
                      <tr>
                        <td
                          align="center"
                          bgcolor="#101b2d"
                          style="background-color: #101b2d; padding: 40px 32px 36px 32px;"
                        >
                          <p
                            style="
                              margin: 0 0 8px 0;
                              font-size: 13px;
                              font-weight: 600;
                              letter-spacing: 1px;
                              text-transform: uppercase;
                              color: #d64545;
                            "
                          >
                            Inquiry Received
                          </p>
                          <p style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">
                            Thank You for Reaching Out
                          </p>
                        </td>
                      </tr>
                    </table>

                    <table
                      role="presentation"
                      border="0"
                      cellpadding="0"
                      cellspacing="0"
                      width="100%"
                      class="wrapper"
                      style="border-collapse: collapse; width: 100%;"
                    >
                      <tr>
                        <td style="padding: 36px 40px 8px 40px;">
                          <p style="margin: 0 0 16px 0; font-size: 16px; color: #1a1f2b;">
                            Dear ${name},
                          </p>
                          <p style="margin: 0 0 16px 0; font-size: 16px; color: #4b5563; line-height: 1.6;">
                            Thank you for contacting ${config.essentials.appName}. We confirm that your inquiry has been received and is currently being reviewed by our team.
                          </p>
                          <p style="margin: 0 0 16px 0; font-size: 16px; color: #4b5563; line-height: 1.6;">
                            One of our representatives will get back to you shortly with the information you need.
                          </p>
                          <p style="margin: 0 0 16px 0; font-size: 15px; color: #4b5563; line-height: 1.6;">
                            If there is any additional information you would like to share in the meantime, simply reply to this email.
                          </p>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding: 4px 40px 32px 40px; border-top: 1px solid #eef0f3;">
                          <p style="margin: 24px 0 0 0; font-size: 15px; color: #4b5563;">
                            Thank you for considering ${config.essentials.appName}.
                          </p>
                          <p style="margin: 4px 0 0 0; font-size: 15px; color: #101b2d; font-weight: 600;">
                            The ${config.essentials.appName} Team
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding: 24px 16px 0 16px;">
                    <p style="margin: 0; font-size: 12px; color: #9a9ea6;">
                      &copy; ${new Date().getFullYear()} ${config.essentials.appName}. All rights reserved.
                    </p>
                    <p style="margin: 6px 0 0 0; font-size: 12px;">
                      <a href="https://mypageseo.com/" style="color: #9a9ea6; text-decoration: underline;">mypageseo.com</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
    `;
};

export const contactUsAdminEmailFormat = (
  full_name: string,
  business_name: string,
  email: string,
  phone_number: string,
  business_website: string,
  business_location: string,
  company_size: string,
  primary_interest: string,
  goals_or_challenges: string,
) => {
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #eef0f3; font-size: 14px; color: #9a9ea6; width: 40%; vertical-align: top;">${label}</td>
      <td style="padding: 10px 0; border-bottom: 1px solid #eef0f3; font-size: 15px; color: #101b2d; font-weight: 600; vertical-align: top;">${value}</td>
    </tr>
  `;

  return `<!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <title>New Contact Us Inquiry</title>
        <style media="all" type="text/css">
          @media only screen and (max-width: 640px) {
            .main p,
            .main td,
            .main span {
              font-size: 15px !important;
            }
            .wrapper {
              padding: 24px !important;
            }
            .container {
              width: 100% !important;
            }
            .main {
              border-radius: 0 !important;
            }
          }
          @media all {
            .ExternalClass {
              width: 100%;
            }
            .ExternalClass,
            .ExternalClass p,
            .ExternalClass span,
            .ExternalClass font,
            .ExternalClass td,
            .ExternalClass div {
              line-height: 100%;
            }
            .apple-link a {
              color: inherit !important;
              font-family: inherit !important;
              font-size: inherit !important;
              font-weight: inherit !important;
              line-height: inherit !important;
              text-decoration: none !important;
            }
            #MessageViewBody a {
              color: inherit;
              text-decoration: none;
              font-size: inherit;
              font-family: inherit;
              font-weight: inherit;
              line-height: inherit;
            }
          }
        </style>
      </head>
      <body
        style="
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          font-size: 16px;
          line-height: 1.5;
          -ms-text-size-adjust: 100%;
          -webkit-text-size-adjust: 100%;
          background-color: #f4f5f7;
          margin: 0;
          padding: 0;
        "
      >
        <table
          role="presentation"
          border="0"
          cellpadding="0"
          cellspacing="0"
          width="100%"
          bgcolor="#f4f5f7"
          style="border-collapse: collapse; width: 100%; background-color: #f4f5f7;"
        >
          <tr>
            <td align="center" style="padding: 40px 16px;">
              <table
                role="presentation"
                border="0"
                cellpadding="0"
                cellspacing="0"
                width="600"
                class="container"
                style="border-collapse: collapse; width: 600px; max-width: 600px;"
              >
                <tr>
                  <td align="center" style="padding-bottom: 20px;">
                    <p
                      style="
                        margin: 0;
                        font-size: 15px;
                        font-weight: 700;
                        letter-spacing: 0.5px;
                        color: #101b2d;
                        text-transform: uppercase;
                      "
                    >
                      ${config.essentials.appName}
                    </p>
                  </td>
                </tr>

                <tr>
                  <td
                    class="main"
                    style="
                      background-color: #ffffff;
                      border: 1px solid #eaebed;
                      border-radius: 12px;
                      overflow: hidden;
                    "
                  >
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; width: 100%;">
                      <tr>
                        <td
                          align="center"
                          bgcolor="#101b2d"
                          style="background-color: #101b2d; padding: 40px 32px 36px 32px;"
                        >
                          <p
                            style="
                              margin: 0 0 8px 0;
                              font-size: 13px;
                              font-weight: 600;
                              letter-spacing: 1px;
                              text-transform: uppercase;
                              color: #d64545;
                            "
                          >
                            New Lead
                          </p>
                          <p style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">
                            Contact Us Inquiry
                          </p>
                        </td>
                      </tr>
                    </table>

                    <table
                      role="presentation"
                      border="0"
                      cellpadding="0"
                      cellspacing="0"
                      width="100%"
                      class="wrapper"
                      style="border-collapse: collapse; width: 100%;"
                    >
                      <tr>
                        <td style="padding: 32px 40px 8px 40px;">
                          <p style="margin: 0 0 20px 0; font-size: 15px; color: #4b5563; line-height: 1.6;">
                            A new Contact Us inquiry has been submitted through the website. Details are below.
                          </p>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding: 0 40px 8px 40px;">
                          <table
                            role="presentation"
                            border="0"
                            cellpadding="0"
                            cellspacing="0"
                            width="100%"
                            style="
                              border-collapse: collapse;
                              width: 100%;
                              background-color: #f8f9fb;
                              border: 1px solid #eef0f3;
                              border-radius: 10px;
                            "
                          >
                            <tr>
                              <td style="padding: 20px 24px;">
                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
                                  ${row('Full Name', full_name)}
                                  ${row('Business Name', business_name)}
                                  ${row('Email', email)}
                                  ${row('Phone Number', phone_number || 'N/A')}
                                  ${row('Business Website', business_website || 'N/A')}
                                  ${row('Business Location', business_location || 'N/A')}
                                  ${row('Company Size', company_size)}
                                  ${row('Primary Interest', primary_interest)}
                                  ${row('Goals / Challenges', goals_or_challenges)}
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding: 28px 40px 32px 40px; border-top: 1px solid #eef0f3;">
                          <p style="margin: 24px 0 0 0; font-size: 15px; color: #4b5563;">
                            Please log in to the admin panel to review and follow up with this inquiry.
                          </p>
                          <p style="margin: 12px 0 0 0; font-size: 15px; color: #101b2d; font-weight: 600;">
                            ${config.essentials.appName} Website
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding: 24px 16px 0 16px;">
                    <p style="margin: 0; font-size: 12px; color: #9a9ea6;">
                      &copy; ${new Date().getFullYear()} ${config.essentials.appName}. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
    `;
};