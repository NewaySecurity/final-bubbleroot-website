// Enhanced AI Image Generator with Multiple Free Models
// This file contains additional AI generation capabilities

class AIImageGenerator {
    constructor() {
        this.models = {
            'realistic': {
                primary: 'stabilityai/stable-diffusion-xl-base-1.0',
                fallback: 'runwayml/stable-diffusion-v1-5',
                description: 'High-quality realistic images'
            },
            'artistic': {
                primary: 'runwayml/stable-diffusion-v1-5',
                fallback: 'CompVis/stable-diffusion-v1-4',
                description: 'Creative and artistic styles'
            },
            'cartoon': {
                primary: 'prompthero/openjourney-v4',
                fallback: 'nitrosocke/Arcane-Diffusion',
                description: 'Cartoon and animated styles'
            },
            'abstract': {
                primary: 'CompVis/stable-diffusion-v1-4',
                fallback: 'stabilityai/stable-diffusion-2-1',
                description: 'Abstract and experimental art'
            }
        };

        this.freeServices = [
            {
                name: 'Pollinations AI',
                baseUrl: 'https://image.pollinations.ai/prompt/',
                method: 'GET',
                formatPrompt: (prompt, style, size) => {
                    const dimensions = size.split('x');
                    const stylePrompt = style !== 'realistic' ? ` ${style} style` : '';
                    return {
                        url: `${this.freeServices[0].baseUrl}${encodeURIComponent(prompt + stylePrompt)}?width=${dimensions[0]}&height=${dimensions[1]}&nologo=true&private=true`,
                        timeout: 30000
                    };
                }
            },
            {
                name: 'Hugging Face',
                baseUrl: 'https://api-inference.huggingface.co/models/',
                method: 'POST',
                formatPrompt: (prompt, style, size) => {
                    const model = this.models[style].primary;
                    const dimensions = size.split('x');
                    return {
                        url: `${this.freeServices[1].baseUrl}${model}`,
                        body: JSON.stringify({
                            inputs: prompt,
                            parameters: {
                                width: parseInt(dimensions[0]),
                                height: parseInt(dimensions[1]),
                                num_inference_steps: 25,
                                guidance_scale: 7.5,
                                negative_prompt: "blurry, low quality, distorted, ugly, bad anatomy"
                            }
                        }),
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    };
                }
            },
            {
                name: 'Alternative API',
                baseUrl: 'https://api.deepai.org/api/text2img',
                method: 'POST',
                formatPrompt: (prompt, style, size) => {
                    const stylePrompt = style !== 'realistic' ? ` in ${style} style` : '';
                    return {
                        url: this.freeServices[2].baseUrl,
                        body: new FormData(),
                        formData: {
                            text: prompt + stylePrompt
                        }
                    };
                }
            }
        ];

        this.currentRequest = null;
        this.generationHistory = [];
    }

    async generateImage(prompt, style = 'realistic', size = '512x512') {
        if (!prompt || prompt.trim().length === 0) {
            throw new Error('Prompt cannot be empty');
        }

        // Cancel any existing request
        if (this.currentRequest) {
            this.currentRequest.abort();
        }

        const controller = new AbortController();
        this.currentRequest = controller;

        try {
            // Try each service in order
            for (let i = 0; i < this.freeServices.length; i++) {
                const service = this.freeServices[i];
                
                try {
                    console.log(`Trying ${service.name}...`);
                    const result = await this.tryService(service, prompt, style, size, controller.signal);
                    
                    if (result) {
                        // Store in history
                        this.generationHistory.push({
                            prompt,
                            style,
                            size,
                            service: service.name,
                            timestamp: new Date(),
                            success: true
                        });
                        
                        return result;
                    }
                } catch (error) {
                    console.warn(`${service.name} failed:`, error.message);
                    
                    // If it's an abort error, stop trying other services
                    if (error.name === 'AbortError') {
                        throw error;
                    }
                    
                    // Continue to next service
                    continue;
                }
            }

            // If all services failed, try fallback
            return await this.tryFallbackService(prompt, style, size);

        } catch (error) {
            // Store failed attempt in history
            this.generationHistory.push({
                prompt,
                style,
                size,
                service: 'failed',
                timestamp: new Date(),
                success: false,
                error: error.message
            });

            throw error;
        } finally {
            this.currentRequest = null;
        }
    }

    async tryService(service, prompt, style, size, signal) {
        const config = service.formatPrompt(prompt, style, size);
        
        const fetchOptions = {
            method: service.method,
            signal,
            timeout: config.timeout || 30000
        };

        if (config.headers) {
            fetchOptions.headers = config.headers;
        }

        if (config.body) {
            fetchOptions.body = config.body;
        }

        if (config.formData) {
            const formData = new FormData();
            for (const [key, value] of Object.entries(config.formData)) {
                formData.append(key, value);
            }
            fetchOptions.body = formData;
        }

        const response = await fetch(config.url, fetchOptions);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Handle different response types
        if (service.name === 'Pollinations AI') {
            // Direct image URL
            await this.testImageLoad(config.url);
            return {
                imageUrl: config.url,
                type: 'url',
                service: service.name
            };
        } else if (service.name === 'Hugging Face') {
            // Blob response
            const blob = await response.blob();
            
            // Check if it's actually an image
            if (!blob.type.startsWith('image/')) {
                throw new Error('Response is not an image');
            }
            
            const imageUrl = URL.createObjectURL(blob);
            return {
                imageUrl,
                blob,
                type: 'blob',
                service: service.name
            };
        } else {
            // JSON response with image URL
            const data = await response.json();
            
            if (data.output_url) {
                await this.testImageLoad(data.output_url);
                return {
                    imageUrl: data.output_url,
                    type: 'url',
                    service: service.name
                };
            } else {
                throw new Error('No image URL in response');
            }
        }
    }

    async tryFallbackService(prompt, style, size) {
        try {
            // Use a curated image service as final fallback
            const keywords = this.extractKeywords(prompt);
            const fallbackUrl = `https://source.unsplash.com/800x600/?${keywords}`;
            
            await this.testImageLoad(fallbackUrl);
            
            return {
                imageUrl: fallbackUrl,
                type: 'url',
                service: 'Unsplash (fallback)',
                isFallback: true
            };
        } catch (error) {
            throw new Error('All image generation services are currently unavailable. Please try again later.');
        }
    }

    extractKeywords(prompt) {
        // Simple keyword extraction for fallback service
        const commonWords = ['a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must', 'this', 'that', 'these', 'those'];
        
        const words = prompt.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 2 && !commonWords.includes(word))
            .slice(0, 3);
        
        return words.join(',') || 'nature,landscape,art';
    }

    async testImageLoad(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(url);
            img.onerror = () => reject(new Error('Image failed to load'));
            img.src = url;
            
            // Timeout after 10 seconds
            setTimeout(() => {
                reject(new Error('Image load timeout'));
            }, 10000);
        });
    }

    getGenerationHistory() {
        return this.generationHistory;
    }

    getSuccessRate() {
        if (this.generationHistory.length === 0) return 0;
        
        const successful = this.generationHistory.filter(h => h.success).length;
        return (successful / this.generationHistory.length) * 100;
    }

    cancelCurrentGeneration() {
        if (this.currentRequest) {
            this.currentRequest.abort();
            this.currentRequest = null;
        }
    }
}

// Export for use in main script
window.AIImageGenerator = AIImageGenerator;
