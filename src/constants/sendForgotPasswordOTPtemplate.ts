import config from '../configs/config';
const forgotPasswordSendOTPFormat = (otp: number | string) => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Forgot Password</title>
    <style>
        /* Center the content vertically and horizontally */
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            padding: 0;
            font-family: Arial, sans-serif;
            background-color: #f2f2f2;
        }

        /* Container for the content */
        .container {
            text-align: left; /* Align the content to the left */
            max-width: 600px;
            width: 100%;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 5px;
        }

        /* Headings */
        h3, h5 {
            margin: 10px 0;
        }

        /* Paragraph */
        p {
            margin: 10px 0;
            font-size: 14px; /* Set the font size to smaller */
        }

        /* Image and paragraph in a row */
        .row {
            display: flex;
            align-items: center;
        }

        /* Spacing between image and paragraph */
        .row img {
            margin-right: 10px;
        }

        /* Responsive styles */
        @media (max-width: 600px) {
            body {
                align-items: flex-start;
            }

            .container {
                border-radius: 0;
            }

            .row {
                flex-direction: column; /* Stack the image and paragraph vertically on smaller screens */
                align-items: flex-start; /* Align the content to the left on smaller screens */
            }

            .row img {
                margin-right: 0; /* Remove the margin on smaller screens */
                margin-bottom: 10px; /* Add bottom margin to the image on smaller screens */
            }
        }
    </style>
    </head>
    <body>
        <div class="container">
            <h1>Dear User,</h1>
            <h3>A Forgot Password OTP request has been submitted from your account.</h3>
            <h3>Use this secret code: ${otp} to change your password.</h3>
            <p style="font-size: 12px;">If you did not request any forgot password request, please ignore this email.</p>
            <div class="row">
            <p>${config.essentials.appName}</p>
            </div>
        </div>
    </body>
    </html>`;
};

export default forgotPasswordSendOTPFormat;