'use strict';

const {expect} = require('chai');
const ChaturbateController = require('../index');

describe('ChaturbateController', () => {
  it('should be exported', () => {
    expect(ChaturbateController).to.not.equal(undefined);
  });
});
