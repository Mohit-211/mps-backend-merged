import passwordValidator from 'password-validator';
const schema = new passwordValidator();

// Add properties to it
schema
  .is()
  .min(8) // Minimum length 8
  .is()
  .max(100) // Maximum length 100
  .has()
  .digits(2) // Must have at least 2 digits
  .has()
  .not()
  .spaces() // Should not have spaces
  .is()
  .not()
  .oneOf(['Passw0rd', 'Password123']); // Blacklist these values

const validatePassword = (pass: string): boolean | string[] => {
  const validationResult = schema.validate(pass);
  if (validationResult === true) {
    return true; 
  } else {
    return false;
  }
};

export default validatePassword;
