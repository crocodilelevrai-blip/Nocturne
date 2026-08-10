const fs = require('fs');
const path = require('path');
const makeStory = require('../lib/story-factory');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.json'));

const stories = files
	.map(f => {
		try {
			const data = require(path.join(__dirname, f));
			return makeStory(data);
		} catch (err) {
			return null;
		}
	})
	.filter(Boolean);

module.exports = stories;
