#!/usr/bin/env node

// Test script to verify audio streaming methods work
const ytdl = require('ytdl-core');

async function testStreaming() {
    const testUrl = 'https://www.youtube.com/watch?v=knW7-x7Y7RE';
    
    console.log('🧪 Testing audio streaming methods...');
    console.log('Test URL:', testUrl);
    
    // Test ytdl-core
    console.log('\n1️⃣ Testing ytdl-core...');
    try {
        if (ytdl.validateURL(testUrl)) {
            console.log('✅ URL validation passed');
            
            const info = await ytdl.getBasicInfo(testUrl);
            console.log('✅ Basic info retrieved:', info.videoDetails.title);
            
            // Test actual streaming (this is where it usually fails)
            console.log('Testing actual stream creation...');
            const stream = ytdl(testUrl, {
                filter: 'audioonly',
                quality: 'highestaudio',
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                }
            });
            
            // Wait a moment to see if stream errors
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    stream.destroy();
                    resolve();
                }, 2000);
                
                stream.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
                
                stream.on('info', () => {
                    clearTimeout(timeout);
                    stream.destroy();
                    resolve();
                });
            });
            
            console.log('✅ ytdl-core stream test passed');
        } else {
            console.log('❌ URL validation failed');
        }
    } catch (error) {
        console.log('❌ ytdl-core failed:', error.message);
    }
    
    // Test play-dl
    console.log('\n2️⃣ Testing play-dl...');
    try {
        const playDL = require('play-dl');
        
        const info = await playDL.video_info(testUrl);
        console.log('✅ play-dl info retrieved:', info.video_details.title);
        
        console.log('✅ play-dl working as fallback');
    } catch (error) {
        console.log('❌ play-dl failed:', error.message);
    }
    
    console.log('\n🎯 Test completed!');
}

// Run the test
testStreaming().catch(console.error);
