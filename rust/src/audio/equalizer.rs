use napi_derive::napi;

use super::biquad::{BiquadFilter, BiquadFilterType, FilterConfig};

#[derive(Debug, Clone)]
#[napi]
pub struct Equalizer {
    filters: Vec<BiquadFilter>,
    sample_rate: f64,
}

#[napi]
impl Equalizer {
    #[napi(constructor)]
    pub fn new(filter_configs: Vec<FilterConfig>, sample_rate: f64) -> Self {
        let filters = filter_configs
            .into_iter()
            .map(|config| BiquadFilter::new(config, sample_rate))
            .collect();

        Self {
            filters,
            sample_rate,
        }
    }

    #[napi]
    pub fn update_filters(&mut self, filter_configs: Vec<FilterConfig>) {
        self.filters.clear();
        self.filters = filter_configs
            .into_iter()
            .map(|config| BiquadFilter::new(config, self.sample_rate))
            .collect();
    }

    #[napi]
    pub fn add_filter(&mut self, config: FilterConfig) {
        self.filters.push(BiquadFilter::new(config, self.sample_rate));
    }

    #[napi]
    pub fn remove_filter(&mut self, index: i32) -> bool {
        if index >= 0 && (index as usize) < self.filters.len() {
            self.filters.remove(index as usize);
            true
        } else {
            false
        }
    }

    #[napi]
    pub fn process(&mut self, input: f64) -> f64 {
        self.filters.iter_mut().fold(input, |acc, filter| filter.process(acc))
    }

    #[napi]
    pub fn process_buffer(&mut self, buffer: Vec<f64>) -> Vec<f64> {
        buffer
            .into_iter()
            .map(|x| self.process(x))
            .collect()
    }

    #[napi]
    pub fn reset(&mut self) {
        for filter in &mut self.filters {
            filter.reset();
        }
    }

    #[napi]
    pub fn get_filter_count(&self) -> i32 {
        self.filters.len() as i32
    }
}

