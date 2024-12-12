const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  fermentationTitle: {
    type: String,
    required: false,
    trim: true
  },
  thresholds: {
    temperature: {
      min: { type: Number, required: false },
      max: { type: Number, required: false }
    },
    humidity: {
      min: { type: Number, required: false },
      max: { type: Number, required: false }
    },
    pressure: {
      min: { type: Number, required: false },
      max: { type: Number, required: false }
    },
    distance: {
      min: { type: Number, required: false },
      max: { type: Number, required: false }
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);
module.exports = User; 