// Simple working replacement for createAudioStream function
// Copy this to replace the existing function in musicUtils.js

async function createAudioStream(url) {
    console.log('🎵 Attempting to stream from:', url);
    
    // Try play-dl first (more reliable)
    try {
        const playDL = require('play-dl');
        console.log('📺 Using play-dl...');
        
        // Get video info first to validate
        const info = await playDL.video_info(url);
        console.log('✅ Video found:', info.video_details.title);
        
        // Create stream
        const streamObj = await playDL.stream(url, { 
            quality: 2,
            discordPlayerCompatibility: true 
        });
        
        console.log('✅ play-dl stream created successfully');
        return { stream: streamObj.stream, inputType: 'opus' };
        
    } catch (playDlError) {
        console.log('❌ play-dl failed:', playDlError.message);
        console.log('🔄 Trying fallback method...');
    }

    // Fallback to ytdl-core with safe settings
    try {
        const ytdl = require('ytdl-core');
        console.log('📺 Using ytdl-core fallback...');
        
        if (!ytdl.validateURL(url)) {
            throw new Error('Invalid YouTube URL');
        }
        
        // Use simplest possible options
        const stream = ytdl(url, {
            filter: 'audioonly',
            quality: 'lowest', // Use lowest to avoid signature issues
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        });
        
        console.log('✅ ytdl-core fallback stream created');
        return { stream, inputType: 'arbitrary' };
        
    } catch (ytdlError) {
        console.log('❌ ytdl-core fallback also failed:', ytdlError.message);
    }
    
    // If all methods fail
    throw new Error('🚫 All streaming methods failed. Please try again later.');
}
