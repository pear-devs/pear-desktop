use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[napi]
pub enum BiquadFilterType {
    Lowpass = 0,
    Highpass = 1,
    Bandpass = 2,
    Lowshelf = 3,
    Highshelf = 4,
    Peaking = 5,
    Notch = 6,
    Allpass = 7,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[napi(object)]
pub struct FilterConfig {
    pub filter_type: BiquadFilterType,
    pub frequency: f64,
    pub q: f64,
    pub gain: f64,
}

#[derive(Debug, Clone)]
#[napi]
pub struct BiquadFilter {
    filter_type: BiquadFilterType,
    frequency: f64,
    q: f64,
    gain: f64,
    // Biquad filter coefficients
    a0: f64,
    a1: f64,
    a2: f64,
    b0: f64,
    b1: f64,
    b2: f64,
    // State variables for filter history
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
    sample_rate: f64,
}

impl BiquadFilter {
    #[napi(constructor)]
    pub fn new(config: FilterConfig, sample_rate: f64) -> Self {
        let mut filter = Self {
            filter_type: config.filter_type,
            frequency: config.frequency,
            q: config.q,
            gain: config.gain,
            a0: 0.0,
            a1: 0.0,
            a2: 0.0,
            b0: 0.0,
            b1: 0.0,
            b2: 0.0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
            sample_rate,
        };
        filter.update_coefficients();
        filter
    }

    #[napi]
    pub fn update_config(&mut self, config: FilterConfig) {
        self.filter_type = config.filter_type;
        self.frequency = config.frequency;
        self.q = config.q;
        self.gain = config.gain;
        self.update_coefficients();
    }

    #[napi]
    pub fn process(&mut self, input: f64) -> f64 {
        // Direct Form I implementation
        let output = self.b0 * input + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;

        // Update history
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = output;

        output / self.a0
    }

    #[napi]
    pub fn process_buffer(&mut self, buffer: Vec<f64>) -> Vec<f64> {
        buffer.into_iter().map(|x| self.process(x)).collect()
    }

    #[napi]
    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }

    fn update_coefficients(&mut self) {
        let w0 = 2.0 * std::f64::consts::PI * self.frequency / self.sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * self.q);
        let a = 10_f64.powf(self.gain / 40.0);
        let s = 1.0;
        let sqrt_a = a.sqrt();

        match self.filter_type {
            BiquadFilterType::Lowpass => {
                self.b0 = (1.0 - cos_w0) / 2.0;
                self.b1 = 1.0 - cos_w0;
                self.b2 = (1.0 - cos_w0) / 2.0;
                self.a0 = 1.0 + alpha;
                self.a1 = -2.0 * cos_w0;
                self.a2 = 1.0 - alpha;
            }
            BiquadFilterType::Highpass => {
                self.b0 = (1.0 + cos_w0) / 2.0;
                self.b1 = -(1.0 + cos_w0);
                self.b2 = (1.0 + cos_w0) / 2.0;
                self.a0 = 1.0 + alpha;
                self.a1 = -2.0 * cos_w0;
                self.a2 = 1.0 - alpha;
            }
            BiquadFilterType::Bandpass => {
                self.b0 = alpha;
                self.b1 = 0.0;
                self.b2 = -alpha;
                self.a0 = 1.0 + alpha;
                self.a1 = -2.0 * cos_w0;
                self.a2 = 1.0 - alpha;
            }
            BiquadFilterType::Notch => {
                self.b0 = 1.0;
                self.b1 = -2.0 * cos_w0;
                self.b2 = 1.0;
                self.a0 = 1.0 + alpha;
                self.a1 = -2.0 * cos_w0;
                self.a2 = 1.0 - alpha;
            }
            BiquadFilterType::Allpass => {
                self.b0 = 1.0 - alpha;
                self.b1 = -2.0 * cos_w0;
                self.b2 = 1.0 + alpha;
                self.a0 = 1.0 + alpha;
                self.a1 = -2.0 * cos_w0;
                self.a2 = 1.0 - alpha;
            }
            BiquadFilterType::Lowshelf => {
                self.b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha);
                self.b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
                self.b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha);
                self.a0 = (a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha;
                self.a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
                self.a2 = (a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha;
            }
            BiquadFilterType::Highshelf => {
                self.b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha);
                self.b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
                self.b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha);
                self.a0 = (a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha;
                self.a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
                self.a2 = (a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha;
            }
            BiquadFilterType::Peaking => {
                self.b0 = 1.0 + alpha * a;
                self.b1 = -2.0 * cos_w0;
                self.b2 = 1.0 - alpha * a;
                self.a0 = 1.0 + alpha / a;
                self.a1 = -2.0 * cos_w0;
                self.a2 = 1.0 - alpha / a;
            }
        }
    }
}

