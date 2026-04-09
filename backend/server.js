// Backend server.js file with corrections

// Assuming you're using Socket.IO
const io = require('socket.io')(server);

// Updated logic for group creation
function createGroup(groupData) {
    // group creation logic
    const groupId = ...; // generated group id
    const members = groupData.members; // list of members to notify
    members.forEach(memberId => {
        socket.to(memberId).emit('groupCreated', { groupId }); // targeted broadcast
    });
}

// Updated logic for message delivery
function sendMessage(messageData) {
    const { chatId, message, participants } = messageData;
    participants.forEach(participantId => {
        socket.to(participantId).emit('messageReceived', message); // targeted message delivery
    });
}

// Updated routing for call events
app.post('/api/call', (req, res) => {
    // handle call event
});

// Adding support for SMS sending
function sendSMS(phoneNumber, message) {
    // logic to send SMS using a third-party service
}

// Implementing access control checks
function checkAccess(userId, action) {
    // logic to check user access for the requested action
}
   
// Your server related code continues here...