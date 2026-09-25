import config from '../configs/config';

const onboardingWelcomeEmailFormat = (name: string) => {
  return `<!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <title>Welcome to MyPageSeo</title>
        <style media="all" type="text/css">
          @media all {
            .btn-primary table td:hover {
              background-color: #b53838 !important;
            }

            .btn-primary a:hover {
              background-color: #b53838 !important;
              border-color: #b53838 !important;
            }
          }
          @media only screen and (max-width: 640px) {
            .main p,
            .main td,
            .main span {
              font-size: 16px !important;
            }

            .wrapper {
              padding: 8px !important;
            }

            .content {
              padding: 0 !important;
            }

            .container {
              padding: 0 !important;
              padding-top: 8px !important;
              width: 100% !important;
            }

            .main {
              border-left-width: 0 !important;
              border-radius: 0 !important;
              border-right-width: 0 !important;
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
          font-family: Helvetica, sans-serif;
          -webkit-font-smoothing: antialiased;
          font-size: 16px;
          line-height: 1.3;
          -ms-text-size-adjust: 100%;
          -webkit-text-size-adjust: 100%;
          background-color: #f4f5f6;
          margin: 0;
          padding: 0;
        "
      >
        <table
          role="presentation"
          border="0"
          cellpadding="0"
          cellspacing="0"
          class="body"
          style="
            border-collapse: separate;
            mso-table-lspace: 0pt;
            mso-table-rspace: 0pt;
            background-color: #f4f5f6;
            width: 100%;
          "
          width="100%"
          bgcolor="#f4f5f6"
        >
          <tr>
            <td
              style="
                font-family: Helvetica, sans-serif;
                font-size: 16px;
                vertical-align: top;
              "
              valign="top"
            >
              &nbsp;
            </td>
            <td
              class="container"
              style="
                font-family: Helvetica, sans-serif;
                font-size: 16px;
                vertical-align: top;
                max-width: 600px;
                padding: 0;
                padding-top: 40px;
                padding-bottom: 40px;
                width: 600px;
                margin: 0 auto;
              "
              width="600"
              valign="top"
            >
              <div
                class="content"
                style="
                  box-sizing: border-box;
                  display: block;
                  margin: 0 auto;
                  max-width: 600px;
                  padding: 0;
                "
              >
                <!-- START CENTERED WHITE CONTAINER -->
                <span
                  class="preheader"
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
                  >Welcome to ${config.essentials.appName}</span
                >
                <table
                  role="presentation"
                  border="0"
                  cellpadding="0"
                  cellspacing="0"
                  class="main"
                  style="
                    border-collapse: separate;
                    mso-table-lspace: 0pt;
                    mso-table-rspace: 0pt;
                    background: #ffffff;
                    border: 1px solid #eaebed;
                    border-radius: 16px;
                    width: 100%;
                  "
                  width="100%"
                >
                  <!-- START HEADER -->
                  <tr>
                    <td
                      style="
                        font-family: Helvetica, sans-serif;
                        font-size: 16px;
                        vertical-align: top;
                        box-sizing: border-box;
                        padding: 32px 24px;
                        text-align: center;
                        background-color: #101b2d;
                        border-radius: 16px 16px 0 0;
                      "
                      valign="top"
                      align="center"
                      bgcolor="#101b2d"
                    >
                      <p
                        style="
                          font-family: Helvetica, sans-serif;
                          font-size: 22px;
                          font-weight: bold;
                          margin: 0;
                          color: #ffffff;
                        "
                      >
                        Welcome to ${config.essentials.appName}
                        <span style="color: #d64545;">.</span>
                      </p>
                    </td>
                  </tr>
                  <!-- START MAIN CONTENT AREA -->
                  <tr>
                    <td
                      class="wrapper"
                      style="
                        font-family: Helvetica, sans-serif;
                        font-size: 16px;
                        vertical-align: top;
                        box-sizing: border-box;
                        padding: 24px;
                      "
                      valign="top"
                    >
                      <p
                        style="
                          font-family: Helvetica, sans-serif;
                          font-size: 16px;
                          font-weight: normal;
                          margin: 0;
                          margin-bottom: 16px;
                        "
                      >
                        Hi ${name},
                      </p>
                      <p
                        style="
                          font-family: Helvetica, sans-serif;
                          font-size: 16px;
                          font-weight: normal;
                          margin: 0;
                          margin-bottom: 16px;
                        "
                      >
                        Welcome to MyPageSeo! 🎉
                      </p>
                      <p
                        style="
                          font-family: Helvetica, sans-serif;
                          font-size: 16px;
                          font-weight: normal;
                          margin: 0;
                          margin-bottom: 16px;
                        "
                      >
                        Thank you for choosing MyPageSeo to help grow your business and improve your visibility on Google.
                      </p>
                      <p
                        style="
                          font-family: Helvetica, sans-serif;
                          font-size: 16px;
                          font-weight: normal;
                          margin: 0;
                          margin-bottom: 16px;
                        "
                      >
                        We have successfully received your payment, and your onboarding is now underway. Our team will review your details and reach out to you shortly to get everything started.
                      </p>
                      <p
                        style="
                          font-family: Helvetica, sans-serif;
                          font-size: 16px;
                          font-weight: normal;
                          margin: 0;
                          margin-bottom: 16px;
                        "
                      >
                        During the onboarding process, we will understand your business, target locations, services, and goals so we can build the right local SEO strategy for you.
                      </p>

                      <table
                        role="presentation"
                        border="0"
                        cellpadding="0"
                        cellspacing="0"
                        style="
                          border-collapse: separate;
                          mso-table-lspace: 0pt;
                          mso-table-rspace: 0pt;
                          width: 100%;
                          background-color: #f4f5f6;
                          border-radius: 8px;
                          margin-bottom: 16px;
                        "
                        width="100%"
                      >
                        <tr>
                          <td
                            style="
                              font-family: Helvetica, sans-serif;
                              font-size: 16px;
                              vertical-align: top;
                              padding: 16px 20px;
                            "
                            valign="top"
                          >
                            <p
                              style="
                                font-family: Helvetica, sans-serif;
                                font-size: 13px;
                                font-weight: bold;
                                letter-spacing: 0.5px;
                                text-transform: uppercase;
                                color: #9a9ea6;
                                margin: 0;
                                margin-bottom: 12px;
                              "
                            >
                              What happens next?
                            </p>
                            <p
                              style="
                                font-family: Helvetica, sans-serif;
                                font-size: 16px;
                                font-weight: normal;
                                margin: 0;
                                margin-bottom: 8px;
                              "
                            >
                              • Our team will contact you shortly
                            </p>
                            <p
                              style="
                                font-family: Helvetica, sans-serif;
                                font-size: 16px;
                                font-weight: normal;
                                margin: 0;
                                margin-bottom: 8px;
                              "
                            >
                              • We will collect the information needed to get started
                            </p>
                            <p
                              style="
                                font-family: Helvetica, sans-serif;
                                font-size: 16px;
                                font-weight: normal;
                                margin: 0;
                                margin-bottom: 8px;
                              "
                            >
                              • We will set up and optimize your local SEO campaign
                            </p>
                            <p
                              style="
                                font-family: Helvetica, sans-serif;
                                font-size: 16px;
                                font-weight: normal;
                                margin: 0;
                              "
                            >
                              • You will receive regular updates and reports on your progress
                            </p>
                          </td>
                        </tr>
                      </table>

                      <p
                        style="
                          font-family: Helvetica, sans-serif;
                          font-size: 16px;
                          font-weight: normal;
                          margin: 0;
                          margin-bottom: 16px;
                        "
                      >
                        If you have any questions in the meantime, simply reply to this email and our team will be happy to help.
                      </p>
                      <p
                        style="
                          font-family: Helvetica, sans-serif;
                          font-size: 16px;
                          font-weight: normal;
                          margin: 0;
                          margin-bottom: 16px;
                        "
                      >
                        Once again, welcome to MyPageSeo. We are excited to work with you and help your business get found by more local customers.
                      </p>
                      <p
                        style="
                          font-family: Helvetica, sans-serif;
                          font-size: 0.8em;
                          font-weight: normal;
                          margin: 0;
                          margin-bottom: 16px;
                        "
                      >
                        Best regards,
                        <br />
                        Team MyPageSeo
                      </p>
                    </td>
                  </tr>

                  <!-- END MAIN CONTENT AREA -->
                </table>

                <!-- END CENTERED WHITE CONTAINER -->
              </div>
            </td>
            <td
              style="
                font-family: Helvetica, sans-serif;
                font-size: 16px;
                vertical-align: top;
              "
              valign="top"
            >
              &nbsp;
            </td>
          </tr>
        </table>
      </body>
    </html>
    `;
};

export default onboardingWelcomeEmailFormat;