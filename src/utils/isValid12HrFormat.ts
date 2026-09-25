function validateTime12HourFormat(time) {
    const regex = /^(0[1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM)$/i;
    return regex.test(time);
}

export default validateTime12HourFormat;