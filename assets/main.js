import { behaviors } from './behaviours.js';
import { credentials as GOOGLE_CREDENTIALS } from './google_creds.js';

class ConversationManager {
    constructor(mistyWorker, mistyIP) {
        this.mistyWorker = mistyWorker;
        this.mistyIP = mistyIP;
        this.states = {
            IDLE: 'idle',
            SPEAKING: 'speaking',
            TRANSITIONING: 'transitioning',
            LISTENING: 'listening',
            CONFIRMING: 'confirming',
            PROCESSING: 'processing'
        };
        this.currentState = this.states.IDLE;
        this.isRecording = false;
        this.audioContext = null;
        this.mediaStream = null;
        this.processor = null;
        this.lastTranscript = "";
        this.ws = null;
        this.setupWebSocket();
        this.isMistySpeaking = false;
        this.noResponseTimeout = null;
        this.noResponseDuration = 10000; // 10 seconds
        this.fullRecording = [];
    }

    setupWebSocket() {
        console.log('Setting up WebSocket connection...');
        this.ws = new WebSocket('ws://localhost:8765');
        this.ws.onopen = () => {
            console.log('WebSocket connected');
        };
        this.ws.onmessage = async (event) => {
            const response = JSON.parse(event.data);
            console.log('Server response:', response);
            await this.handleServerResponse(response);
        };
        this.ws.onerror = (error) => console.error('WebSocket error:', error);
        this.ws.onclose = () => {
            console.log('WebSocket closed, reconnecting...');
            setTimeout(() => this.setupWebSocket(), 5000);
        };
    }

    async beginConversation(commentId, text, emotion) {
        console.log('Beginning conversation:', { commentId, text, emotion });
        this.currentCommentId = commentId;
        await this.setState(this.states.SPEAKING);
        await this.speak(text);
        await this.setState(this.states.LISTENING);
    }

    async setState(newState) {
        console.log(`State transition: ${this.currentState} -> ${newState}`);
        this.currentState = newState;

        switch (newState) {
            case this.states.SPEAKING:
                await this.stopListening();
                break;
            case this.states.TRANSITIONING:
                if (this.isRecording) {
                    await this.stopListening();
                }
                break;
            case this.states.LISTENING:
                await this.startListening();
                break;
            case this.states.IDLE:
                await this.stopListening();
                break;
        }

        console.log(`Robot state changed to: ${this.currentState}`);
    }

    async startListening() {
        try {
            console.log('Starting audio recording...');
            this.isRecording = true;
            this.lastTranscript = "";
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            this.audioContext = new AudioContext({ sampleRate: 16000 });
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
            source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            this.processor.onaudioprocess = (e) => {
                if (!this.isRecording) return;
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
                }
                this.fullRecording.push(pcmData);
                if (this.ws?.readyState === WebSocket.OPEN) {
                    const base64data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
                    this.ws.send(JSON.stringify({ type: 'audio_data', audio: base64data }));
                }
            };
            console.log('Audio recording started');
            this.startNoResponseTimer();
        } catch (error) {
            console.error('Failed to start recording:', error);
            this.isRecording = false;
        }
    }

    async stopListening() {
        console.log('Stopping audio recording...');
        this.isRecording = false;
        this.clearNoResponseTimer();
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        if (this.audioContext) {
            await this.audioContext.close();
        }
        this.audioContext = null;
        this.processor = null;
        this.mediaStream = null;
    }

    startNoResponseTimer() {
        this.clearNoResponseTimer();
        this.noResponseTimeout = setTimeout(() => {
            this.handleNoResponse();
        }, this.noResponseDuration);
    }

    clearNoResponseTimer() {
        if (this.noResponseTimeout) {
            clearTimeout(this.noResponseTimeout);
            this.noResponseTimeout = null;
        }
    }

    async handleNoResponse() {
        console.log('No response detected');
        await this.speak("It seems like nobody's here. Let me know when you're ready to continue.");
        await this.setState(this.states.IDLE);
    }

    async handleServerResponse(response) {
        console.log('Server response:', response);
        
        if (this.isMistySpeaking) {
            console.log('Ignoring audio input while Misty is speaking');
            return;
        }

        switch (response.type) {
            case 'intent_classification':
                await this.handleIntentClassification(response.intent);
                break;
            case 'speech_recognized':
                if (response.result?.text) {
                    this.clearNoResponseTimer();
                    this.lastTranscript = response.result.text;
                    console.log('Recognized speech:', this.lastTranscript);
                    this.startNoResponseTimer();
                }
                break;
            case 'silence_detected':
                if (this.currentState === this.states.LISTENING && this.lastTranscript) {
                    console.log('Silence detected, moving to confirmation');
                    await this.setState(this.states.CONFIRMING);
                    await this.speak("Would you like to add anything else?");
                    await this.confirmAdditionalInput();
                }
                break;
        }
    }

    getEmotionForState() {
        const emotions = {
            [this.states.SPEAKING]: 'interest',
            [this.states.TRANSITIONING]: 'anticipation',
            [this.states.LISTENING]: 'anticipation',
            [this.states.CONFIRMING]: 'trust',
            [this.states.PROCESSING]: 'anticipation',
            [this.states.IDLE]: 'default'
        };
        return emotions[this.currentState] || 'default';
    }

    async speak(text) {
        return new Promise((resolve) => {
            if (!this.mistyWorker) {
                resolve();
                return;
            }
            const handleSpeechComplete = async (event) => {
                if (event.data.type === 'AUDIO_COMPLETE') {
                    console.log("Speech complete");
                    this.mistyWorker.removeEventListener('message', handleSpeechComplete);
                    this.isMistySpeaking = false;
                    await this.setState(this.states.TRANSITIONING);
                    setTimeout(async () => {
                        if (this.currentState !== this.states.IDLE) {
                            await this.setState(this.states.LISTENING);
                        }
                        resolve();
                    }, 1500);
                }
            };
            this.mistyWorker.addEventListener('message', handleSpeechComplete);
            this.setState(this.states.SPEAKING);
            this.isMistySpeaking = true;
            this.mistyWorker.postMessage({
                payload: {
                    endpoint: this.mistyIP,
                    type: 'SPEAK',
                    text: text,
                    emotion: this.getEmotionForState(),
                    activity: 'speak'
                }
            });
        });
    }

    async handleIntentClassification(intent) {
        switch (intent) {
            case 'positive':
                await this.speak("Great! Go ahead and tell me what else you'd like to add.");
                await this.setState(this.states.LISTENING);
                break;
            case 'negative':
                await this.speak("Alright! Finish up reading the next part. I can't wait to discuss!");
                await this.saveRecording();
                await this.setState(this.states.IDLE);
                break;
            case 'uncertain':
                await this.speak("Okie Dokie! We'll move on when you're ready.");
                await this.setState(this.states.CONFIRMING);
                break;
        }
    }

    async confirmAdditionalInput() {
        this.startNoResponseTimer();
        const userResponse = await this.waitForUserResponse();
        this.clearNoResponseTimer();
        if (userResponse) {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'classify_intent', text: userResponse }));
            }
        } else {
            await this.handleNoResponse();
        }
    }

    async waitForUserResponse() {
        return new Promise((resolve) => {
            const checkTranscript = setInterval(() => {
                if (this.lastTranscript) {
                    clearInterval(checkTranscript);
                    resolve(this.lastTranscript);
                    this.lastTranscript = "";
                }
            }, 100);

            setTimeout(() => {
                clearInterval(checkTranscript);
                resolve(null);
            }, this.noResponseDuration);
        });
    }

    async saveRecording() {
        console.log('Saving full recording...');
        const fullAudio = new Float32Array(this.fullRecording.reduce((acc, curr) => [...acc, ...curr], []));
        const wavBlob = this.exportWAV(fullAudio);
        const fileName = `recording_${Date.now()}.wav`;
        
        // Save the recording to a local folder
        const link = document.createElement('a');
        link.href = URL.createObjectURL(wavBlob);
        link.download = `recordings/${fileName}`;
        link.click();

        this.fullRecording = []; // Clear the recording buffer
    }

    exportWAV(audioData) {
        const buffer = new ArrayBuffer(44 + audioData.length * 2);
        const view = new DataView(buffer);

        function writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        const sampleRate = 16000;
        const numChannels = 1;

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 32 + audioData.length * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * 2, true);
        view.setUint16(32, numChannels * 2, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, audioData.length * 2, true);

        const volume = 1;
        let index = 44;
        for (let i = 0; i < audioData.length; i++) {
            view.setInt16(index, audioData[i] * (0x7FFF * volume), true);
            index += 2;
        }

        return new Blob([view], { type: 'audio/wav' });
    }
}

(function($) {

    // @TODO replace with server url in production
    var SERVER_URL = 'http://localhost:8000';
    
    var misty_IP = '192.168.1.168'
    let currentCommentId;
    let recordingInProgress = false;
    let isReadyToRecord = false;
    let recordingFilename;
    let mistyWorker;
    let conversationManager;
    let isReadyInstructionPlayed = false;
    let studentDB = {};  
    $.getJSON('./studentDB.json', function(data) {
    studentDB = data; 
    console.log('Loaded studentDB:', studentDB);
    });

    let laptopRecorder, audioChunks = [];
    let recordingBlob;
    let recordingMode = 'robot';  // Default mode

    var a1, a2, a3, b1, b2, b3, c1, c2, c3;
    a1 = b2 = c3 = [3, 6, 9, 13, 16, 21, 22, 23, 28, 30];
    a2 = b1 = c2 = [2, 4, 6, 9, 12, 20, 21, 22, 29];
    a3 = b3 = c1 = [3, 6, 9, 22, 23, 28, 30];
    var commentPinCount = 1;
    var redactPinCount = 1;
    var pagesOffsetTop = $('#editor-body').offset().top;
    var pagesOffsetLeft = $('#editor-body').offset().left;
    var scrolledDistance = 0;
    var emotionsList = ['anger', 'anticipation', 'disgust', 'fear', 'joy', 'sadness', 'surprise', 'trust']
    var pins = [];
    var redactors = [];
    var meta = {};
    var loginGroup = "";
    window.pathArticleTitle = $('#assignment-title').text().trim();;
    var selectedText = '';
    var commentsGroup = 'all';
    var quickComments = [{ // comment library
            'group': 'student-summary',
            'desc': 'Summary',
            'show_items': 1,
            'comments': [{
                    'text': `I'm a little confused, can you explain that to me?`,
                    'emotion': 'anticipation'
                },
                {
                    'text': `I THINK I understood, but could you summarize what that means for me?`,
                    'emotion': 'anticipation'
                },
                {
                    'text': `How would you explain this to someone else in class?`,
                    'emotion': 'anticipation'
                },
                {
                    'text': `So in other words, ______ _______`,
                    'emotion': 'joy'
                },
                {
                    'text': `I can think of a couple more examples, such as ______ and _____`,
                    'emotion': 'joy'
                },
                {
                    'text': `This reminds me of that class activity we did, where we _______`,
                    'emotion': 'surprise'
                }
            ]
        },
        // {
        //     'group': 'expand-predict',
        //     'desc': 'Expand Predict',
        //     'show_items': 1,
        //     'comments': [{
        //             'text': `Can you think of a couple of other examples of this?`,
        //             'emotion': 'Questioning'
        //         },
        //         {
        //             'text': `Wow! That sounds incredible, do you think its always true?`,
        //             'emotion': 'Surprised'
        //         },
        //         {
        //             'text': `That's interesting, what do you think would happen next?`,
        //             'emotion': 'Surprised'
        //         },
        //         {
        //             'text': `Not only that, but I also know that _________`,
        //             'emotion': 'Default'
        //         },
        //         {
        //             'text': `Another example of this would be _______`,
        //             'emotion': 'Attentive'
        //         },
        //         {
        //             'text': `I have also learned that ______`,
        //             'emotion': 'Happy'
        //         }
        //     ]
        // },
        {
            'group': 'vocab-support',
            'desc': 'Vocabulary Support',
            'show_items': 1,
            'comments': [{
                    'text': `Hoooold on. Can you tell me what  ______ means?`,
                    'emotion': 'anticipation'
                },
                {
                    'text': `Huh? What do you think they mean when they say ____?`,
                    'emotion': 'anticipation'
                },
                {
                    'text': `I've heard ____ before, I think it means ______.`,
                    'emotion': 'joy'
                },
                {
                    'text': `I think when they're saying ____ it means ______.`,
                    'emotion': 'joy'
                }
            ]
        },
        {
            'group': 'personal-connection',
            'desc': 'Personal Connection',
            'show_items': 1,
            'comments': [{
                    'text': `Is there something in your home that works this way?`,
                    'emotion': 'anticipation'
                },
                {
                    'text': `How do you think this might inform someone doing sports?`,
                    'emotion': 'anticipation'
                },
                {
                    'text': `Knowing this, would you change how you go about your day?`,
                    'emotion': 'anticipation'
                },
                {
                    'text': `Do you think this is something robots like me should know?`,
                    'emotion': 'joy'
                }
            ]
        },
        // {
        //     'group': 'recalling-past-events',
        //     'desc': 'Recalling Past Events',
        //     'show_items': 1,
        //     'comments': [{
        //             'text': `I remember there was something like that in class - do you remember what it was?`,
        //             'emotion': 'Questioning'
        //         },
        //         {
        //             'text': `Do you remember something we did in class like this?`,
        //             'emotion': 'Surprised'
        //         },
        //         {
        //             'text': `Is this something you'd enjoy doing in class? I would!`,
        //             'emotion': 'Happy'
        //         },
        //         {
        //             'text': `Hmmm. Do you remember reading something about this in class?`,
        //             'emotion': 'Questioning'
        //         }
        //     ]
        // },
        {
            'group': 'emotional-connection',
            'desc': 'Emotional Connection',
            'show_items': 1,
            'comments': [{
                    'text': `That's so surpising to me!`,
                    'emotion': 'surprise'
                },
                {
                    'text': `I think this is probably the key bit for us to understand!`,
                    'emotion': 'anticipation'
                },
                {
                    'text': `This would be a lot of fun to do in class!`,
                    'emotion': 'joy'
                },
                {
                    'text': `Can you imagine how that feels?`,
                    'emotion': 'anticipation'
                },
                {
                    'text': `Woah! That's so cool`,
                    'emotion': 'surprised'
                }
            ]
        }
    ];

    $(document).ready(function() {
        preInit();
        init();
        initWorker();
        $('#recording-mode').on('change', function() {
            recordingMode = $(this).val();
            if (recordingMode === 'laptop') {
                $('#laptop-controls').show();  // Show laptop controls
            } else {
                $('#laptop-controls').hide();  // Hide laptop controls
            }
        });
    
        // Handle laptop recording start/stop
        $('#start-stop-recording').on('click', function() {
            if (!laptopRecorder) {
                startLaptopRecording();
            } else {
                stopLaptopRecording();
            }
        });
    
        // Play the recorded audio
        $('#play-laptop-recording').on('click', function() {
            if (recordingBlob) {
                const audioUrl = URL.createObjectURL(recordingBlob);
                const audio = new Audio(audioUrl);
                audio.play();
            }
        });


        $(document).on('click', '.comments-list-toggle', function() {
            $('main').attr('data-comments-toggle', '0');
            $('#comments-column-toggler').attr('data-toggler', '0');
        });
        $(document).on('click', '.comments-template-toggle', function() {
            $('main').attr('data-comments-toggle', '1');
            $('#comments-column-toggler').attr('data-toggler', '1');
        });
        $(document).on('click', '#audiences>p', function() {
            if ($(this).parent().attr('data-toggler') == '0') {
                $(this).parent().attr('data-toggler', '1');
            }
        });
        $(document).on('click', '.audience-class li', function() {
            $('.audience-class li').removeClass('selected');
            $(this).addClass('selected');
            var classID = $(this).attr('data-id').trim();
            var groupID = $(this).parents('#audiences').attr('data-group').trim();
            $(this).parents('#audiences').attr('data-class', classID);
            updateStudents(classID, groupID);
        });
        $(document).on('click', '.audience-groups li', function() {
            $('#audiences>p>span').text($(this).text().trim());
            $('.audience-groups li').removeClass('active');
            $(this).addClass('active');
            var classID = $(this).parents('#audiences').attr('data-class').trim();
            var groupID = $(this).attr('data-id').trim();
            $(this).parents('#audiences').attr('data-group', groupID);
            updateStudents(classID, groupID);
        });
        $(document).on('click', '.audience-students li', function() {
            $(this).toggleClass('selected');

        });
        $(document).on('click', function(e) {
            var container = $("#audiences");
            if (!$(e.target).closest(container).length) {
                $('#audiences').attr('data-toggler', '0');
            }
        });
        $(document).on('click', '.add-comment-btn', function() {
            if ($('main').attr('data-comments') == '0') {
                $('main').attr('data-comments', '1');
            } else {
                $('main').attr('data-comments', 0);
            }
        });
        $(document).on('click', '#selected-emotion>p', function() {
            if ($(this).parent().attr('data-toggler') == '0') {
                $(this).parent().attr('data-toggler', '1');
            } else {
                $(this).parent().attr('data-toggler', '0');
            }
        });
        $(document).on('click', '#selected-emotion > ul li', function() {
            var $this = $(this);
            var emotionId = getEmotionId($(this).text().trim());
            $('#selected-emotion > ul li').removeClass('active');
            $this.addClass('active');
            $this.parents('#selected-emotion').children('p').text($(this).text().trim());
            $this.parents('#selected-emotion').attr('data-toggler', '0');
            // console.log("emotion selected")
            if (emotionId !== "") {
                // console.log("valid emotion selected, resetting")
                $this.parents('#robot-emotions').attr('class', 'blink');
                setTimeout(function() {
                    $this.parents('#robot-emotions').attr('class', $this.text().trim().toLowerCase());
                }, 150);
            }
            if ($('.cp.focused').length == 1) {
                $('.cp#' + $('.cp.focused').attr('id')).attr('data-emotion', emotionId);
                $('#comments-list [data-id="' + $('.cp.focused').attr('id') + '"]').attr('data-emotion', emotionId);
                managePin($('.cp.focused').attr('id'), 'updateEmotion', emotionId);
            }
        });
        $('#editor').scroll(function() {
            scrolledDistance = parseInt($("#editor").scrollTop());
        });
        $(document).on('dragover', '#pages', function(e) {
            e.preventDefault();
        });
        $(document).on('dragstart', '.cn, .ce, .cp, .re, .rp', function(e) {
            if ($(this).hasClass('cp') || $(this).hasClass('rp')) {
                var srcTop = (e.originalEvent.clientY - pagesOffsetTop) + scrolledDistance;
                var srcLeft = e.originalEvent.clientX - pagesOffsetLeft;
                var diffY = srcTop - parseInt($(this).css('top'), 10);
                var diffX = srcLeft - parseInt($(this).css('left'), 10);
                e.originalEvent.dataTransfer.setData("text/plain", diffY + '-' + diffX);
            }
            e.originalEvent.dataTransfer.setData("text/html", e.target.outerHTML);
        });
        $(document).on('drop', '#pages', function(e) {
            e.preventDefault();
            // console.log("pin dropped!")
            //init();
            var elem = $.parseHTML(e.originalEvent.dataTransfer.getData("text/html"))[0];
            var posTop = (e.originalEvent.clientY - pagesOffsetTop) + scrolledDistance;
            var posLeft = e.originalEvent.clientX - pagesOffsetLeft;
            var cText = $(elem).text().trim();
            var cEmotion = $(elem).attr('data-emotion');
            var editorWidth = $('#editor').width();
            var diffY = 0;
            var diffX = 0;
            if ($(elem).hasClass('cn')) {
                cText = '';
            }
            if ($(elem).hasClass('cp') || $(elem).hasClass('rp')) {
                diffY = e.originalEvent.dataTransfer.getData("text/plain").split('-')[0];
                diffX = e.originalEvent.dataTransfer.getData("text/plain").split('-')[1];
            }
            if ($(elem).hasClass('cp')) {
                var cID = $(elem).attr('id').trim();
                $(document).find('.cp#' + cID).css('top', posTop - diffY);
                $(document).find('.cp#' + cID).css('left', posLeft - diffX);
                $(document).find('#comments-list>ul [data-id="' + cID + '"]').attr('data-top', posTop - diffY);
                $(document).find('#comments-list>ul [data-id="' + cID + '"]').attr('data-left', posLeft - diffX);
                if ((posLeft + 160) >= editorWidth) {
                    $(document).find('.cp#' + cID).addClass('edged');
                } else {
                    $(document).find('.cp#' + cID).removeClass('edged');
                }
                $(document).find('.cp#' + cID + '>p').click();
                sortComments(cID);
            }
            if ($(elem).hasClass('cn') || $(elem).hasClass('ce')) {
                $('#pages').append('<div data-emotion="' + cEmotion + '" data-comment="' + cText + '" id="c' + commentPinCount + '" class="cp" draggable="true" style="top:' + posTop + 'px; left:' + posLeft + 'px;"><p>' + commentPinCount + '</p><ul><li class="delete-pin">Delete</li><li class="duplicate-pin">Duplicate</li><li class="new-pin">Create New</li></ul></div>');
                $(document).find('.cp#c' + commentPinCount + '>p').click();
                $('#comments-list>ul').append('<li data-top="' + posTop + '" data-left="' + posLeft + '" data-comment="' + cText + '" data-emotion="' + cEmotion + '" data-id="c' + commentPinCount + '"><span class="comment-id">' + commentPinCount + '</span><p>' + cText + '</p></li>');
                sortComments('c' + commentPinCount);
                commentPinCount++;
                if ($(elem).hasClass('cn')) {
                    $('#comment-input textarea').attr('placeholder', '[Create your own comment]');
                }
                // This always crashes
                if ($(elem).hasClass('ce')) {
                    var groupName = $(elem).attr('data-parent').trim();
                    var currentCommentId = $(elem).attr('data-id').trim();
                    var latestCommentId = $('#comments-template [data-group="' + groupName + '"]').attr('data-latest').trim();
                    $(document).find('#comments-template [data-id="' + currentCommentId + '"][data-parent="' + groupName + '"]').remove();
                    getNextComment(groupName, latestCommentId);
                }
                if ((posLeft + 160) >= editorWidth) {
                    $(document).find('.cp#c' + (commentPinCount - 1)).addClass('edged');
                } else {
                    $(document).find('.cp#c' + (commentPinCount - 1)).removeClass('edged');
                }
            }
            if ($(elem).hasClass('re')) {
                $('#pages').append('<div id="r' + redactPinCount + '" class="rp" draggable="true" style="top:' + posTop + 'px; left:' + posLeft + 'px;"><ul><li class="delete-redactor">Delete</li><li class="duplicate-redactor">Duplicate</li></ul></div>');
                redactPinCount++;
            }
            if ($(elem).hasClass('rp')) {
                var rID = $(elem).attr('id').trim();
                $(document).find('.rp#' + rID).css('top', posTop - diffY);
                $(document).find('.rp#' + rID).css('left', posLeft - diffX);
            }
        });
        $(document).on('drop', '#comment-input textarea', function(e) {
            e.preventDefault();
        });
        $(document).on('click', '.cp>p', function() {
            var $this = $(this).parent();
            $('.cp').removeClass('focused');
            $($this).addClass('focused');
            $(document).find('#selected-emotion > ul li[data-id="' + $($this).attr('data-emotion').trim() + '"]').click();
            $('#comment-input textarea').val($($this).attr('data-comment').trim());
            if ($($this).attr('data-comment').trim() == '') {
                $('#comment-input[data-play]').removeAttr('data-play');
            } else {
                $('#comment-input').attr('data-play', 1);
            }
            // console.log('pin clicked')
            // Necessary to prevent multiple calls to fetchEmotion
            if ($($this).attr('data-emotion').trim() == '') {
                // console.log('pin does not have a valid emotion, refreshing')
                prevEmotQueryText = "";
                refreshEmotion();
            } else {
                // console.log('pin has a valid emotion, no need to refresh')
                prevEmotQueryText = $($this).attr('data-comment').trim();
            }
            $('#comment-input textarea').focus();
        });
        $(document).on('click', '#comments-list ul li', function() {
            $(document).find('.cp#' + $(this).attr('data-id') + '>p').click();
            $('#editor').animate({ scrollTop: $('#editor').offset().top + parseInt($('.cp#' + $(this).attr('data-id')).css('top'), 10) - 200 }); // 200 = 116(height from body top to pages/editor top is 116) + 84(scroll to 84px above the pin)
        });
        $(document).on('input', '#comment-input textarea', function() {
            if ($('.cp.focused').length == 1) {
                $('.cp#' + $('.cp.focused').attr('id')).attr('data-comment', $(this).val());
                $('#comments-list [data-id="' + $('.cp.focused').attr('id') + '"]').attr('data-comment', $(this).val());
                $('#comments-list [data-id="' + $('.cp.focused').attr('id') + '"] > p').text($(this).val());
                managePin($('.cp.focused').attr('id'), 'updateComment', $(this).val());
            }
            if ($(this).val().trim() == '') {
                $('#comment-input[data-play]').removeAttr('data-play');
            } else {
                $('#comment-input').attr('data-play', 1);
            }
        });
        $(document).on('click', '#group-name p', function() {
            $(this).parents('#group-name').toggleClass('active');
        });
        $(document).on('click', '#group-name li:not(.active)', function() {
            var $this = $(this);
            $('#group-name li').removeClass('active');
            $this.addClass('active');
            $('#group-name p span').text($this.text());
            $('#group-name p span').attr("data-group-id", $this.attr("data-group"));
            $this.parents('#group-name').toggleClass('active');
        });
        $(document).on('click', '#article-menu p', function() {
            $(this).parents('#article-menu').toggleClass('active');
        });
        $(document).on('click', '#article-menu li:not(.active)', function() {
            var $this = $(this);
            $('#article-menu li').removeClass('active');
            $this.addClass('active');
            $('#article-menu p span').text($this.text());
            $this.parents('#article-menu').toggleClass('active');
            localStorage.setItem("currentArticle", $this.attr('data-article'));
            localStorage.setItem("currentArticleTitle", $this.text().trim());
            setTimeout(function() {
                location.reload();
            }, 500);
        });
        $(document).on('click', '#comments-category p', function() {
            $(this).parents('#comments-category').toggleClass('active');
        });
        $(document).on('click', '#comments-category li:not(.active)', function() {
            var $this = $(this);
            $('#comments-category li').removeClass('active');
            $this.addClass('active');
            $('#comments-category p span').text($this.text());
            commentsGroup = $this.attr('data-group').trim().toLowerCase();
            $this.parents('#comments-category').toggleClass('active');
            setTimeout(function() {
                $('.refresh-btn').click();
            }, 100);
        });
        $(document).on('click', '.refresh-btn', function() {
            var $this = $(this);
            $this.addClass('active');
            $this.addClass('ai-active');
            if (selectedText == '') {
                $this.removeClass('ai-active');
                if (commentsGroup == 'all') {
                    $.each($('#comments-template ul[data-group]'), function() {
                        var groupName = $(this).attr('data-group');
                        var latestCommentId = $(this).attr('data-latest');
                        setTimeout(function() {
                            $(document).find('#comments-template [data-parent="' + groupName + '"]').remove();
                            getNextComment(groupName, latestCommentId);
                            reorder();
                            $this.removeClass('active');
                        }, 1000);
                    });
                } else {
                    setTimeout(function() {
                        $('#comments-template > ul > .ce:not(.cai)').remove();
                        for (var i = 0; i < 3; i++) {
                            var latestCommentId = $('ul[data-group="' + commentsGroup + '"]').attr('data-latest');
                            getNextComment(commentsGroup, latestCommentId);
                        }
                        if (selectedText == '') {
                            $('.cai').remove();
                        }
                        reorder();
                        $this.removeClass('active');
                    }, 1000);
                }
            } else {
                var counter = 0;
                var counterVal = setInterval(function() {
                    ++counter;
                }, 1);
                //highlight(selectedText);
                //console.log("Sending Request");
                if (selectedText.length > 0) {
                    $.ajax(SERVER_URL + '/comment', {
                        'data': JSON.stringify({ text: selectedText }),
                        'type': 'POST',
                        'contentType': 'application/json'
                    }).done(function(data) {
                        //console.log(data);
                        clearInterval(counterVal);
                        setTimeout(function() {
                            if (commentsGroup == 'all') {
                                $.each($('#comments-template ul[data-group]'), function() {
                                    var groupName = $(this).attr('data-group');
                                    var latestCommentId = $(this).attr('data-latest');
                                    $(document).find('#comments-template [data-parent="' + groupName + '"]').remove();
                                    getNextComment(groupName, latestCommentId);
                                });
                                reorder();
                                $this.removeClass('active');
                                $('.cai').remove();
                                $.each($('#comments-template ul[data-group]'), function() {
                                    var groupName = $(this).attr('data-group');
                                    $(this).append('<li class="ce cai" data-parent="' + groupName + '" draggable="true" data-emotion="">' + data[groupName] + '</li>');
                                });
                            } else {
                                $('#comments-template > ul > .ce:not(.cai)').remove();
                                for (var i = 0; i < 3; i++) {
                                    var latestCommentId = $('ul[data-group="' + commentsGroup + '"]').attr('data-latest');
                                    getNextComment(commentsGroup, latestCommentId);
                                }
                                reorder();
                                $this.removeClass('active');
                                $('.cai').remove();
                                $('#comments-template ul[data-group="' + commentsGroup + '"]').append('<li class="ce cai" data-parent="' + commentsGroup + '" draggable="true" data-emotion="">' + data[commentsGroup] + '</li>');
                            }
                            selectedText = '';
                            $this.removeClass('ai-active');
                        }, (nearestThousand(counter) - counter));
                    }).fail(function(jqXHR, textStatus, errorThrown) {
                        console.log(jqXHR['responseJSON'])
                    });
                }
            }
        });
        $(document).on('click', '.refresh-ai-btn', function() {
            var $this = $(this);
            $this.addClass('active');
            setTimeout(function() {
                // geenrate comments
                // randomly order
                $this.removeClass('active');
            }, 1000);
        });
        $(document).on('click', '.delete-pin', function() {
            managePin($(this).parents('.cp').attr('id'), 'delete');
            $('#comments-list li[data-id="' + $(this).parents('.cp').attr('id') + '"]').remove();
            $(this).parents('.cp').remove();
        });
        $(document).on('click', '.duplicate-pin, .new-pin', function() {
            var target = $(document).find('.cp#' + $(this).parents('.cp').attr('id'));
            var posTop = parseInt(target.css('top'), 10);
            var posLeft = parseInt(target.css('left'), 10);
            var cText = target.attr('data-comment');
            var cEmotion = target.attr('data-emotion');
            var editorHeieght = $('#editor').height();
            if ($(this).hasClass('new-pin')) {
                cText = '';
                cEmotion = 0;
            }
            if ((posTop + 50) >= editorHeieght) {
                posTop -= 50;
            } else {
                posTop += 50;
            }
            $('#pages').append('<div data-emotion="' + cEmotion + '" data-comment="' + cText + '" id="c' + commentPinCount + '" class="cp" draggable="true" style="top:' + posTop + 'px; left:' + posLeft + 'px;"><p>' + commentPinCount + '</p><ul><li class="delete-pin">Delete</li><li class="duplicate-pin">Duplicate</li><li class="new-pin">Create New</li></ul></div>');
            $(document).find('.cp#c' + commentPinCount + '>p').click();
            $('#comments-list>ul').append('<li data-top="' + posTop + '" data-left="' + posLeft + '" data-comment="' + cText + '" data-emotion="' + cEmotion + '" data-id="c' + commentPinCount + '"><span class="comment-id">' + commentPinCount + '</span><p>' + cText + '</p></li>');
            sortComments('c' + commentPinCount);
            commentPinCount++;
        });
        $(document).on('click', '.delete-redactor', function() {
            $(this).parents('.rp').remove();
        });
        $(document).on('click', '.duplicate-redactor', function() {
            var target = $(document).find('.rp#' + $(this).parents('.rp').attr('id'));
            var posTop = parseInt(target.css('top'), 10);
            var posLeft = parseInt(target.css('left'), 10);
            var editorHeieght = $('#editor').height();
            if ((posTop + 110) >= editorHeieght) {
                posTop -= 110;
            } else {
                posTop += 110;
            }
            $('#pages').append('<div id="r' + redactPinCount + '" class="rp" draggable="true" style="top:' + posTop + 'px; left:' + posLeft + 'px;"><ul><li class="delete-redactor">Delete</li><li class="duplicate-redactor">Duplicate</li><li class="duplicate-redactor">Duplicate</li></ul></div>');
            redactPinCount++;
        });
        // $(document).on('click', '#comment-input[data-play="1"] #play', function() {
        //     say($(this).parent().children('textarea').val().trim());
        // });
        
        function startLaptopRecording() {
            navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                laptopRecorder = new MediaRecorder(stream);
                laptopRecorder.ondataavailable = event => {
                    audioChunks.push(event.data);
                };
                laptopRecorder.onstop = () => {
                    recordingBlob = new Blob(audioChunks, { type: 'audio/wav' });
                    audioChunks = [];
                    $('#play-laptop-recording').show();  // Show play button when recording is ready
                };
                laptopRecorder.start();
                $('#start-stop-recording').text('Stop Recording');
            }).catch(error => {
                console.error('Error accessing microphone:', error);
            });
        }
        
        function stopLaptopRecording() {
            if (laptopRecorder) {
                laptopRecorder.stop();
                laptopRecorder = null;
                $('#start-stop-recording').text('Start Recording');
            }
        }

    // Click event for a comment pin
    // $(document).on('click', '.cp', function() {
    //     currentCommentId = $(this).attr('id').trim();
    //     const commentText = $(this).attr('data-comment').trim();
    //     const commentEmotion = $('#selected-emotion > p').text().trim().toLowerCase();
    
    //     console.log('Comment ID:', currentCommentId, 'Text:', commentText, 'Emotion:', commentEmotion);
    
    //     // Check if there is already a recording for this comment
    //     const recordingForComment = getRecordingForComment(currentCommentId);
    
    //     if (mistyWorker) {
    //         if (recordingForComment) {
    //             // If a recording exists, inform the user about re-recording
    //             var speechText = "It seems we did this one already. Press my left bumper to rerecord.";
    //             mistyWorker.postMessage({
    //                 payload: {
    //                     endpoint: misty_IP,
    //                     type: 'SPEAK',
    //                     text: speechText,
    //                     emotion: 'neutral',
    //                     activity: 'inform'
    //                 }
    //             });
    
    //             // Set flag to allow re-recording
    //             isReadyInstructionPlayed = true;
    //             isReadyToRecord = true;  // Bumpers will now listen for re-recording
    
    //         } else {
    //             // If no recording exists, proceed with the usual "I am ready to record" message
    //             mistyWorker.postMessage({
    //                 payload: {
    //                     endpoint: misty_IP,
    //                     type: 'SPEAK',
    //                     text: commentText,
    //                     emotion: commentEmotion,
    //                     activity: 'play'
    //                 }
    //             });

               
    
    //             // Reset the flag and wait for the "I am ready to record" instruction
    //             isReadyInstructionPlayed = false;
    //             isReadyToRecord = false;
    //         }
    //     } else {
    //         console.error('Worker not initialized');
    //     }
    // });

    $(document).on('click', '.cp', function() {
        if (!window.conversationManager) {
            console.error('Conversation manager not initialized');
            return;
        }
    
        const commentId = $(this).attr('id').trim();
        const commentText = $(this).attr('data-comment').trim();
        const commentEmotion = $('#selected-emotion > p').text().trim().toLowerCase();
        
        console.log('Starting conversation:', { commentId, commentText, commentEmotion });
        
        window.conversationManager.beginConversation(commentId, commentText, commentEmotion);
    });

    
        $(document).on('click', '#comment-input[data-play="1"] #play', function() {
            console.log('play button clicked');
            
            var text = $(this).parent().children('textarea').val().trim()
            var emotion = $('#selected-emotion > p').text().trim().toLowerCase();
            var activity = 'play';
            var type = 'SPEAK';
            
            if (mistyWorker) {
                mistyWorker.postMessage({
                    payload: {
                         endpoint: misty_IP,
                        type: type,
                        text: text,
                        emotion: emotion,
                        activity: activity
                    }
                });
            } else {
                console.error('Worker not initialized');
            }
        });

        // $('#emotion-button').on('click', function() {
        //     comment_text = $('#comment-input textarea').val().trim()
        //     $('#emotion-button').prop("disabled",true);
        //     $('#emotion-button').addClass("disabled-button");
        //     $.ajax(SERVER_URL + '/emotion', {
        //         'data': JSON.stringify({ text: comment_text }),
        //         'type': 'POST',
        //         'contentType': 'application/json'
        //     }).done(function(data) {
        //         var emotions = data['emotion_classes']
        //         if (emotions.length == 0){
        //             alert("No emotion labeled");
        //         }
        //         console.log(emotions)
        //         var emotions = emotions.map(function(emot){
        //             return `[${emot}]`
        //         })
        //         console.log(emotions)
        //         var emotions_text = emotions.join(' ')
        //         console.log(emotions_text)
        //         $('#comment-input textarea').val(comment_text + ' ' + emotions_text)

        //     }).fail(function(jqXHR, textStatus, errorThrown){
        //         console.log(jqXHR['responseJSON'])
        //     }).always(function(){
        //         $('#emotion-button').prop("disabled", false);
        //         $('#emotion-button').removeClass("disabled-button");
        //     });
        // });
        $(document).on('input', '#group-password', function() {
            $('#login-error').remove();
        });
        $(document).on('click', '#login', function() {
            var flag = true;
            $.each(groups, function(i, v) {
                if (v.id == $('#group-name > p > span').attr("data-group-id").trim()) {
                    if (v.password == $("#group-password").val()) {
                        localStorage.setItem("auth", v.id);
                        localStorage.setItem("auth-name", v.name);
                        articleList = v.articles;
                        localStorage.setItem("currentArticle", articleList[0].filename);
                        localStorage.setItem("currentArticleTitle", articleList[0].title);
                        flag = false;
                    }
                }
            });
            if (flag) {
                if ($("#login-error").length == 0) {
                    $("#splash > div:not(.brand)").append("<div id='login-error'>The login credentials don't match. Please try again.</div>");
                }
            } else {
                location.reload();
            }
        });
        $(document).on('click', '#guest-login', function() {
            localStorage.setItem("auth", "guest");
            articleList = articles;
            localStorage.setItem("currentArticle", articleList[0].filename);
            localStorage.setItem("currentArticleTitle", articleList[0].title);
            location.reload();
        });
        $(document).on('click', '#logout', function() {
            localStorage.setItem("auth", "true");
            location.reload();
        });
        $(document).on('click', '#resume', function() {
            recreateCanvas();
            $(this).addClass('temporary-hidden');
        });
        $(document).on('click', '#save-btn', function() {
            var url = '/validate/',
                data = {};
            save();
            data.pins = JSON.stringify(pins);
            data.redactors = JSON.stringify(redactors);
            data.meta = JSON.stringify(meta);
            data.uid = window.pathSessionId;
            data.group = loginGroup;
            data.article = $('#assignment-title').text().trim();
            if (pins.length > 0) {
                submitToGoogleForm(JSON.stringify(pins), JSON.stringify(redactors), JSON.stringify(meta), window.pathSessionId, loginGroup);
                $.post(url, { 'save': data }, function(result, success) {
                    if (success == 'success') {
                        var response = result;
                        console.log(response);
                        console.log(data);
                    } else {
                        console.log('Something went wrong!');
                    }
                });
            } else {
                alert('No comments to save');
            }
        });
        $(document).on('mouseup keyup', '#editor-body', function() {
            // if ($('.highlight').length) {
            //     var target = $('.highlight').parent()[0];
            //     $('.highlight').contents().unwrap();
            //     target.normalize();
            // }
            if (typeof window.getSelection != "undefined") {
                selectedText = window.getSelection().toString();
            } else if (typeof document.selection != "undefined" && document.selection.type == "Text") {
                selectedText = document.selection.createRange().text;
            } else {
                selectedText = '';
            }
        });
        $(window).resize(function() {
            $('#outerContainer').width($('#pages').width());
            setTimeout(function() {
                $('#pages').height($('#outerContainer #viewer').height());
            }, 500);
        });

        $('#comment-input textarea').on("focusout", function() {
            refreshEmotion();
        })
    });

    function recreateCanvas() {
        commentPinCount = 1;
        $('#comments-list > ul').empty();
        $('#pages div.cp').remove();
        var recreatePins = JSON.parse($('#resume').attr("data-pins"));
        $.each(recreatePins, function(i, v) {
            var pinId = Number(v.id.slice(1));
            if (pinId >= commentPinCount) {
                commentPinCount = pinId + 1;
            }
            $('#pages').append(`
            <div data-emotion="` + v.emotion + `" data-comment="` + v.text + `" id="c` + pinId + `" class="cp" draggable="true" style="top:` + v.top + `px; left:` + v.left + `px;">
                <p>` + pinId + `</p>
                <ul>
                    <li class="delete-pin">Delete</li>
                    <li class="duplicate-pin">Duplicate</li>
                    <li class="new-pin">Create New</li>
                </ul>
            </div>
            `);
            $('#comments-list > ul').append(`
            <li data-top="` + v.top + `" data-left="` + v.left + `" data-comment="` + v.text + `" data-emotion="` + v.emotion + `" data-id="c` + pinId + `">
                <span class="comment-id">` + pinId + `</span>
                <p>` + v.text + `</p>
            </li>
            `);
        })
        setTimeout(function() {
            $('#comments-list > ul > li[data-id="c' + (commentPinCount - 1).toString() + '"]').click();
        }, 150);
    }

    function reorder() {
        var a = [];
        var b = [];
        for (var i = 0; i < 4;) {
            a[i] = ++i;
        }
        for (var i = 0; i < 4;) {
            b[i] = ++i;
        }
        a = shuffle(a);
        b = shuffle(b);
        console.log(a, b);
        for (var i = 2; i < 6; ++i) {
            $('#comments-category > ul > li:nth-child(' + i + ')').css('order', a[i - 2]);
            $('#comments-template > ul:nth-child(' + i + ')').css('order', b[i - 2]);
        }
    }


    function initWorker() {
        console.log("Initializing worker...");
        try {
            const workerPath = "/PATHWiSE/assets/mistyWorker.js";
            mistyWorker = new Worker(workerPath);
            
            mistyWorker.onerror = (error) => {
                console.error("Worker error:", error);
            };
    
            // Initial connection to Misty
            mistyWorker.postMessage({
                credentials: GOOGLE_CREDENTIALS,
                behaviorsData: behaviors,
                payload: {
                    endpoint: misty_IP,
                    type: 'CONNECT'
                }
            });
    
            mistyWorker.onmessage = handleWorkerMessage;
            
            // Initialize conversation manager as a global variable
            window.conversationManager = new ConversationManager(mistyWorker, misty_IP);
            
        } catch (error) {
            console.error("Worker initialization failed:", error);
        }
    }
    

function handleBumpSensor(bumpSensor) {
    if (isReadyToRecord && bumpSensor === 'LeftBumper') {
        if (!recordingInProgress) {
            // Start recording and pass currentCommentId
            console.log('Starting recording for comment:', currentCommentId);
            mistyWorker.postMessage({
                payload: {
                    endpoint: misty_IP,
                    type: 'RECORD_AUDIO',
                    commentId: currentCommentId  
                }
            });
            recordingInProgress = true;
        } else {
            // Stop recording
            console.log('Stopping recording');
            mistyWorker.postMessage({
                payload: {
                    endpoint: misty_IP,
                    type: 'STOP_RECORD_AUDIO'
                }
            });
            recordingInProgress = false;
        }
    } else if (isReadyToRecord && bumpSensor === 'RightBumper') {
        // Play the recording for the comment
        const recordingForComment = getRecordingForComment(currentCommentId);
        if (recordingForComment) {
            console.log('Playing recording for comment:', currentCommentId);
            mistyWorker.postMessage({
                payload: {
                    endpoint: misty_IP,
                    type: 'PLAY_AUDIO',
                    filename: recordingForComment
                }
            });
        } else {
            // If no recording is available, inform the user
            console.log('No recording available for this comment.');
            mistyWorker.postMessage({
                payload: {
                    endpoint: misty_IP,
                    type: 'SPEAK',
                    text: 'There are no recordings for this exercise. Press my left bumper to start recording.',
                    emotion: 'neutral',
                    activity: 'inform'
                }
            });
        }
    }
}

function getRecordingForComment(commentId) {
    return studentDB[commentId]?.recording || null;  // Fetch the recording or return null if not found
}

function saveRecordingForComment(commentId, filename) {
    if (!studentDB[commentId]) {
        studentDB[commentId] = {};  // Create a new entry if it doesn't exist
    }
    studentDB[commentId].recording = filename;  // Assign the recording filename to the comment

    console.log(`Saved recording for comment ${commentId}: ${filename}`);

    // If needed, display or log the updated studentDB
    console.log('Updated studentDB:', studentDB);
}


// function handleWorkerMessage(event) {
//     const { success, data, type, audioFilename, sensor } = event.data;

//     if (success) {
//         if (type === 'AUDIO_COMPLETE') {
//             if(recordingMode==='laptop'){
//                 return;
//             }

//             if (!isReadyInstructionPlayed) {
//                 // If there was no existing recording, play the "I am ready to record" message
//                 setTimeout(() => {
//                     var speechText = "I am ready to record. Press my left bumper to start recording.";
//                     mistyWorker.postMessage({
//                         payload: {
//                             endpoint: misty_IP,
//                             type: 'SPEAK',
//                             text: speechText,
//                             emotion: 'neutral',
//                             activity: 'inform'
//                         }
//                     });

//                     isReadyInstructionPlayed = true;
//                     isReadyToRecord = true;  // Bumpers will now listen after this message
//                     console.log("Bumpers are now listening.");
//                 }, 3000);
//             } else {
//                 isReadyToRecord = true;  // Bumpers listen after the final message
//             }
//         } else if (type === 'RECORDING_STARTED') {
//             console.log(`Recording started: ${audioFilename}`);
//             recordingFilename = audioFilename;
//         } else if (type === 'RECORDING_STOPPED') {
//             console.log('Recording stopped');
//             saveRecordingForComment(currentCommentId, recordingFilename);

//             // After recording stops, provide instructions for re-recording or playback
//             const speechText = "If you want to record again, press my left bumper. If you want to play the recording, press my right bumper.";
//             mistyWorker.postMessage({
//                 payload: {
//                     endpoint: misty_IP,
//                     type: 'SPEAK',
//                     text: speechText,
//                     emotion: 'neutral',
//                     activity: 'inform'
//                 }
//             });

//             isReadyToRecord = false;  // Temporarily disable bumpers
//         } else if (type === 'BUMP_SENSOR') {
//             handleBumpSensor(sensor);  // Handle bumper interaction
//         }
//     }
// }

function handleWorkerMessage(event) {
    console.log("Worker message received:", event.data);
    const { success, data, type, audioFilename } = event.data;

    if (!success) {
        console.error("Worker message indicated failure:", event.data);
        return;
    }

    console.log("Processing message type:", type);

    switch (type) {
        case 'AUDIO_COMPLETE':
            console.log("Audio complete received");
            if (recordingMode === 'laptop') {
                return;
            }

            if (conversationManager && 
                conversationManager.currentState === conversationManager.states.SPEAKING) {
                console.log('Misty finished speaking, starting to listen...');
                conversationManager.startListening();
            }
            break;

        case 'BEHAVIOR':
        case 'SPEAK':
            // These are expected messages, no special handling needed
            console.log(`${type} action completed`);
            break;

        case 'AUDIO_DELETED':
            console.log(`Successfully deleted audio file: ${audioFilename}`);
            break;

        case 'ERROR':
            console.error('Error from Misty Worker:', data);
            if (conversationManager) {
                conversationManager.resetState();
            }
            break;

        default:
            console.log('Unhandled message type:', type);
            break;
    }
}


    function shuffle(array) {
        var tmp, current, top = array.length;
        if (top)
            while (--top) {
                current = Math.floor(Math.random() * (top + 1));
                tmp = array[current];
                array[current] = array[top];
                array[top] = tmp;
            }
        return array;
    }

    function nearestThousand(n) {
        return Math.ceil(n / 1000) * 1000;
    }

    function highlight(text) {
        var inputText = document.getElementById("editor-body");
        var innerHTML = inputText.innerHTML;
        var index = innerHTML.indexOf(text);
        if (index >= 0) {
            innerHTML = innerHTML.substring(0, index) + "<span class='highlight'>" + innerHTML.substring(index, index + text.length) + "</span>" + innerHTML.substring(index + text.length);
            inputText.innerHTML = innerHTML;
        }
    }

    function submitToGoogleForm(pins, redactors, meta, uid, loginGroup) { // save comment pins with their related comments and emotions etc
        var formid = "e/1FAIpQLScKuIrXyra1lh8Xxt74vbJ9cRr2WfERS8Ho6aQdtSwyA80tYg";
        var data = {
            "entry.2032535083": pins,
            "entry.836476239": redactors,
            "entry.1793196186": meta,
            "entry.1469484922": uid,
            "entry.93229899": loginGroup
        };
        var params = [];
        for (key in data) {
            params.push(key + "=" + encodeURIComponent(data[key]));
        }
        // Submit the form using an image to avoid CORS warnings.
        (new Image).src = "https://docs.google.com/forms/d/" + formid +
            "/formResponse?" + params.join("&");
    }

    function preInit() { // initializes all the default htmls from json objs
        var elem = '';
        if (localStorage.getItem("auth") == "true") {
            $('#splash').removeClass('hide');
            $.each(groups, function(i, v) {
                $('#group-name>ul').append('<li' + (i == 0 ? ' class="active"' : '') + ' data-group="' + v.id + '">' + v.name + '</li>');
            });
            $('#group-name p span').text(groups[0].name);
            $('#group-name p span').attr("data-group-id", groups[0].id);
        } else if (localStorage.getItem("auth") == "guest") {
            $('#splash').addClass('hide');
        } else {
            $("#logged-user > span").text(localStorage.getItem("auth-name").trim());
            $('#splash').addClass('hide');
            var fetchUrl = '/validate/',
                fetchData = {};
            fetchData.group = localStorage.getItem("auth").trim();
            fetchData.article = localStorage.getItem("currentArticleTitle").trim();
            $.post(fetchUrl, { 'fetch': fetchData }, function(result, success) {
                if (success == 'success') {
                    var response = JSON.parse(result);
                    if (response.status) {
                        $('#resume').removeClass('temporary-hidden');
                        $('#resume').attr("data-pins", response.pins);
                    }
                } else {
                    console.log('Something went wrong from fetching the latest data!');
                }
            });
        }
        $.each(articleList, function(i, v) {
            $('#article-menu>ul').append('<li' + (localStorage.getItem('currentArticle') == v.filename ? ' class="active"' : '') + ' data-article="' + v.filename + '">' + v.title + '</li>');
        });
        $('#article-menu p span').text(localStorage.getItem("currentArticleTitle"));
        $('#assignment-title').text(localStorage.getItem("currentArticleTitle"));
        window.pathArticleTitle = localStorage.getItem("currentArticleTitle");
        $.each(emotionsList, function(i, v) {
            $('#selected-emotion>ul').append('<li' + (i == 0 ? ' class="active"' : '') + ' data-id="' + i + '">' + v + '</li>');
        });
        $.each(quickComments, function(i, v) {
            elem += '<ul data-group="' + v.group + '" data-latest="0">';
            var counter = 0;
            $.each(v.comments, function(ci, cv) {
                if (counter < v.show_items) {
                    elem += '<li class="ce" data-id="' + ci + '" data-parent="' + v.group + '" draggable="true" data-emotion="' + getEmotionId(cv.emotion) + '">' + cv.text + '</li>';
                    counter++;
                } else {
                    return false;
                }
            });
            elem += '</ul>';
            $('#comments-category ul').append('<li data-group="' + v.group + '">' + v.desc + '</li>');
        });
        if (quickComments.length > 0 && elem !== '') {
            $('#comments-template').append(elem);
        }
        // get the rendered pdf inside the editor area
        $('#outerContainer').width($('#pages').width());
        setTimeout(function() {
            $('#pages').append($('#outerContainer'));
        }, 300);
        setTimeout(function() {
            $('#pages').height($('#outerContainer #viewer').height());
        }, 1000);
    }

    function init() { // initializes all the default values for auto genrated lists like comments librarry, emotions list, students etc
        $('.audience-groups li:first-child').click();
        $('.audience-class > ul li:first-child').click();
        $('#audiences').attr('data-toggler', '0');
        $(document).find('#selected-emotion > ul li:nth-child(2)').click();
        $('#selected-emotion').attr('data-toggler', '0');
        $('#comment-input textarea').val('');
        $('#comment-input[data-play]').removeAttr('data-play');
    }

    // function say(m) { // create and play audio demos for comments to create 
    //     var msg = new SpeechSynthesisUtterance();
    //     var voices = window.speechSynthesis.getVoices();
    //     msg.voice = voices[1];
    //     msg.voiceURI = "native";
    //     msg.volume = 1;
    //     msg.rate = 0.9;
    //     msg.pitch = 1.4;
    //     msg.text = m;
    //     msg.lang = 'en-US';
    //     speechSynthesis.speak(msg);
    // }

    function managePin(id, action, value) { // update contents: messages, pin number, emotion etc for each selected comment pins
        $.each(pins, function(i, v) {
            if (v.id == id) {
                if (action == 'updateComment') {
                    v.text = value;
                }
                if (action == 'updateEmotion') {
                    v.emotion = value;
                }
                if (action == 'delete') {
                    pins.splice(i, 1);
                }
                return false;
            }
        });
    }

    function getEmotionId(emotion) { // returns the order of the emotion in the json obj of emotions
        var id = "";
        $.each(emotionsList, function(i, v) {
            if (emotion == v) {
                id = i;
            }
        });
        return id;
    }

    function getNextComment(groupName, latestCommentId) { // return the next available comment from a comment group to replace the comment template that has just been dragged onto the editor from the sidebar
        $.each(quickComments, function(i, v) {
            if (v.group.trim() == groupName.trim()) {
                latestCommentId++;
                if (latestCommentId >= v.comments.length) {
                    latestCommentId = 0;
                }
                var cv = v.comments[latestCommentId];
                $('#comments-template [data-group="' + groupName + '"]').append('<li class="ce" data-id="' + latestCommentId + '" data-parent="' + v.group + '" draggable="true" data-emotion="' + getEmotionId(cv.emotion) + '">' + cv.text + '</li>');
                $('#comments-template [data-group="' + groupName + '"]').attr('data-latest', latestCommentId);
            }
        });
    }

    function sortComments(id) { // updates the order of the newly created pin comments in the sidebar as per their position in the editor
        var length = $('#comments-list>ul>li').length;
        if (length > 1) {
            var target = $('#comments-list>ul>li[data-id="' + id + '"]').detach();
            if (length == 2) {
                var firstChild = $('#comments-list>ul>li:first-child');
                if (parseInt($(firstChild).attr('data-top')) > parseInt($(target).attr('data-top'))) {
                    $(firstChild).before(target);
                } else {
                    $(firstChild).after(target);
                }
            } else {
                if (parseInt($(target).attr('data-top')) > parseInt($('#comments-list>ul>li:last-child').attr('data-top'))) {
                    $('#comments-list>ul>li:last-child').after(target);
                } else {
                    for (var i = 1; i < length; i++) {
                        if (parseInt($(target).attr('data-top')) < parseInt($('#comments-list>ul>li:nth-child(' + i + ')').attr('data-top'))) {
                            $('#comments-list>ul>li:nth-child(' + i + ')').before(target);
                            break;
                        } else if ((parseInt($(target).attr('data-top')) > parseInt($('#comments-list>ul>li:nth-child(' + i + ')').attr('data-top'))) && (parseInt($(target).attr('data-top')) < parseInt($('#comments-list>ul>li:nth-child(' + (i + 1) + ')').attr('data-top')))) {
                            $('#comments-list>ul>li:nth-child(' + i + ')').after(target);
                            break;
                        } else {
                            i++;
                        }
                    }
                }
            }
        }
    }

    function updateStudents(classID, groupID) { // generate students list from the json
        $('.audience-students li').removeClass('selected');
        if (groupID != 4) {
            var studentsList = classID + groupID;
            if (studentsList == 'a0' || studentsList == 'b0' || studentsList == 'c0') {
                $('.audience-students li').addClass('selected');
            } else {
                $(eval(studentsList)).each(function(i, v) {
                    $('.audience-students li:nth-child(' + v + ')').addClass('selected');
                });
            }
        }
    }

    function save() { // saves data i.e. comments and emotion, updates values needed to do calculation 
        loginGroup = localStorage.getItem("auth").trim();
        pins = [];
        redactors = [];
        $.each($('#comments-list > ul > li'), function() {
            var comment = {};
            comment.text = $(this).attr('data-comment');
            comment.emotion = $(this).attr('data-emotion');
            comment.top = parseInt($(this).attr('data-top'));
            comment.left = parseInt($(this).attr('data-left'));
            comment.id = $(this).attr('data-id');
            pins.push(comment);
        });
        $.each($('#editor .rp'), function() {
            var redactor = {};
            redactor.id = $(this).attr('id');
            redactor.top = parseInt($(this).css('top'), 10);
            redactor.left = parseInt($(this).css('left'), 10);
            redactors.push(redactor);
        });
        meta.pageWidth = $(window).width();
        meta.pageHeight = $(window).height();
        meta.editorWidth = $('#editor-body').width();
        meta.editorHeight = $('#editor-body').height();
        meta.title = $('#assignment-title').text().trim();
    }

    function fetchEmotion(comment_text, onSuccess, onFail) {
        $.ajax(SERVER_URL + '/emotion', {
            'data': JSON.stringify({ text: comment_text }),
            'type': 'POST',
            'contentType': 'application/json'
        }).done(function(data) {
            var emotions = data['emotion_classes']
            if (emotions.length == 0) {
                alert("Request successful but no emotion labeled");
                emotion = null;
            } else {
                // Take the first emotion returned by the API and map it to emotion category i.e. remove +/- if present
                var emotion = emotions[0]
                if (emotion.includes('+') || emotion.includes('-')) {
                    emotion = emotion.substr(0, emotion.length - 1);
                }
            }
            onSuccess(emotion);
        }).fail(function(jqXHR, textStatus, errorThrown) {
            console.log(jqXHR['responseJSON'])
            onFail();
        })
    }

    var prevEmotQueryText = "";

    // function refreshEmotion() {
    //     comment_text = $('#comment-input textarea').val().trim();
    //     if (comment_text == '') {
    //         emotion = 'anticipation'
    //         $(document).find('#selected-emotion > ul li[data-id="' + getEmotionId(emotion) + '"]').click();
    //     } else if (comment_text != prevEmotQueryText) {
    //         // console.log('fetching new emotion')
    //         var old_class = $('#robot-emotions').attr('class');
    //         $('#robot-emotions').attr('class', 'blink');
    //         fetchEmotion(comment_text, function(emotion) {
    //             if (emotion == null) {
    //                 emotion = 'anticipation';
    //             }
    //             $(document).find('#selected-emotion > ul li[data-id="' + getEmotionId(emotion) + '"]').click();
    //             prevEmotQueryText = comment_text;
    //         }, function() {
    //             $('#robot-emotions').attr('class', old_class);
    //         })
    //     }
    // }

    var prevEmotQueryText = "";

function refreshEmotion() {
    // Get the comment text safely
    var comment_text = $('#comment-input textarea').val() || "";
    comment_text = comment_text.trim();

    if (comment_text === '') {
        emotion = 'anticipation';
        $(document).find('#selected-emotion > ul li[data-id="' + getEmotionId(emotion) + '"]').click();
    } else if (comment_text !== prevEmotQueryText) {
        console.log('Fetching emotion for:', comment_text);
        var old_class = $('#robot-emotions').attr('class');
        $('#robot-emotions').attr('class', 'blink');
        
        fetchEmotion(comment_text, function(emotion) {
            if (emotion == null) {
                emotion = 'anticipation';
            }
            $(document).find('#selected-emotion > ul li[data-id="' + getEmotionId(emotion) + '"]').click();
            prevEmotQueryText = comment_text;
        }, function() {
            $('#robot-emotions').attr('class', old_class);
        });
    }
}

})(window.jQuery);