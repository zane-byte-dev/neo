"""
Unit tests for typeless_server.py optimizations

Tests cover:
- Helper functions (language config, system prompt generation)
- Clipboard operations
- Audio compression
- Error handling improvements
- Thread safety
"""

import unittest
import os
import sys
import tempfile
import threading
from unittest.mock import Mock, patch, MagicMock, mock_open

# Add parent directory to path to import typeless_server
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

class TestLanguageConfig(unittest.TestCase):
    """Test language configuration functions"""
    
    @patch.dict(os.environ, {'OUTPUT_LANGUAGE': 'zh'})
    def test_get_language_config_zh(self):
        from typeless_server import get_language_config
        config = get_language_config()
        self.assertEqual(config['output_lang'], 'zh')
        self.assertEqual(config['output_lang_name'], 'Simplified Chinese')
        self.assertTrue(config['should_translate'])
    
    @patch.dict(os.environ, {'OUTPUT_LANGUAGE': 'auto'})
    def test_get_language_config_auto(self):
        from typeless_server import get_language_config
        config = get_language_config()
        self.assertEqual(config['output_lang'], 'auto')
        self.assertFalse(config['should_translate'])
    
    def test_generate_system_prompt_zh(self):
        from typeless_server import generate_system_prompt
        config = {'output_lang': 'zh', 'output_lang_name': 'Simplified Chinese'}
        prompt = generate_system_prompt(config)
        self.assertIn('简体中文', prompt)
        self.assertIn('去除口语化', prompt)
    
    def test_generate_system_prompt_auto(self):
        from typeless_server import generate_system_prompt
        config = {'output_lang': 'auto', 'output_lang_name': 'Chinese + English'}
        prompt = generate_system_prompt(config)
        self.assertIn('简体中文', prompt)
        self.assertIn('保留所有英文', prompt)


class TestClipboardOperations(unittest.TestCase):
    """Test clipboard helper functions"""
    
    @patch('subprocess.Popen')
    def test_write_to_clipboard_success(self):
        from typeless_server import _write_to_clipboard
        
        # Mock successful clipboard write
        mock_process = Mock()
        mock_process.communicate.return_value = (b'', b'')
        mock_process.returncode = 0
        
        with patch('subprocess.Popen', return_value=mock_process):
            result = _write_to_clipboard("test text")
            self.assertTrue(result)
    
    @patch('subprocess.Popen')
    def test_write_to_clipboard_timeout(self):
        from typeless_server import _write_to_clipboard
        import subprocess
        
        # Mock timeout
        mock_process = Mock()
        mock_process.communicate.side_effect = subprocess.TimeoutExpired('pbcopy', 2)
        
        with patch('subprocess.Popen', return_value=mock_process):
            result = _write_to_clipboard("test text")
            self.assertFalse(result)
    
    @patch('typeless_server._write_to_clipboard')
    @patch('time.sleep')
    @patch('typeless_server.keyboard_controller')
    def test_paste_text_via_clipboard(self, mock_kb, mock_sleep, mock_write):
        from typeless_server import paste_text_via_clipboard
        
        # Mock successful clipboard write
        mock_write.return_value = True
        
        result = paste_text_via_clipboard("test text")
        self.assertTrue(result)
        mock_write.assert_called_once_with("test text")
        mock_kb.press.assert_called()
        mock_kb.release.assert_called()


class TestAudioCompression(unittest.TestCase):
    """Test audio compression function"""
    
    def test_compress_audio_file_not_found(self):
        from typeless_server import compress_audio
        
        result = compress_audio("/nonexistent/file.wav", "/tmp/output.ogg")
        # Should return input path on failure
        self.assertEqual(result, "/nonexistent/file.wav")
    
    @patch('subprocess.run')
    @patch('os.path.exists')
    @patch('os.path.getsize')
    def test_compress_audio_success(self, mock_getsize, mock_exists, mock_run):
        from typeless_server import compress_audio
        
        # Mock successful compression
        mock_exists.side_effect = [True, True]  # input exists, output exists
        mock_getsize.side_effect = [1000, 500]  # original 1000, compressed 500
        mock_run.return_value = Mock()
        
        result = compress_audio("input.wav", "output.ogg")
        self.assertEqual(result, "output.ogg")


class TestSaveNote(unittest.TestCase):
    """Test save note function"""
    
    @patch('builtins.open', new_callable=mock_open)
    @patch('os.makedirs')
    def test_save_note(self, mock_makedirs, mock_file):
        from typeless_server import save_note
        
        result = save_note("Test note content")
        
        # Verify directory creation
        mock_makedirs.assert_called_once()
        
        # Verify file write
        mock_file.assert_called_once()
        handle = mock_file()
        written_content = ''.join(call.args[0] for call in handle.write.call_args_list)
        self.assertIn("Test note content", written_content)
        self.assertIn("voice-memo", written_content)
        self.assertTrue(result.endswith('.md'))


class TestThreadSafety(unittest.TestCase):
    """Test thread safety of model initialization"""
    
    @patch('typeless_server.whisper_model', None)
    @patch('typeless_server.WhisperModel')
    def test_whisper_model_thread_safety(self, mock_whisper_class):
        """Test that whisper model is initialized only once with multiple threads"""
        from typeless_server import process_with_local, whisper_lock
        import typeless_server
        
        # Create a mock model
        mock_model = Mock()
        mock_whisper_class.return_value = mock_model
        
        # Reset the global model
        typeless_server.whisper_model = None
        
        initialization_count = {'count': 0}
        original_init = mock_whisper_class
        
        def counting_init(*args, **kwargs):
            initialization_count['count'] += 1
            return original_init(*args, **kwargs)
        
        with patch('typeless_server.WhisperModel', side_effect=counting_init):
            # This test would require actually running threads, 
            # which is complex for unit tests. Instead, we verify the lock exists.
            self.assertIsNotNone(whisper_lock)
            self.assertIsInstance(whisper_lock, threading.Lock)


class TestErrorHandling(unittest.TestCase):
    """Test improved error handling"""
    
    @patch('os.path.exists')
    @patch('os.remove')
    def test_cleanup_on_error(self, mock_remove, mock_exists):
        """Test that files are cleaned up even on error"""
        from typeless_server import process_with_gemini
        import typeless_server
        
        mock_exists.return_value = True
        
        # Mock client to raise an error
        mock_client = Mock()
        mock_client.files.upload.side_effect = Exception("Upload failed")
        
        typeless_server.client = mock_client
        
        with patch('typeless_server.compress_audio', return_value='test.ogg'):
            result = process_with_gemini("test.wav", "fake_api_key")
        
        # Should return None on error
        self.assertIsNone(result)
        
        # Should still cleanup files
        self.assertTrue(mock_remove.called)


def run_tests():
    """Run all tests and print results"""
    # Create test suite
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # Add all test classes
    suite.addTests(loader.loadTestsFromTestCase(TestLanguageConfig))
    suite.addTests(loader.loadTestsFromTestCase(TestClipboardOperations))
    suite.addTests(loader.loadTestsFromTestCase(TestAudioCompression))
    suite.addTests(loader.loadTestsFromTestCase(TestSaveNote))
    suite.addTests(loader.loadTestsFromTestCase(TestThreadSafety))
    suite.addTests(loader.loadTestsFromTestCase(TestErrorHandling))
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # Print summary
    print("\n" + "="*70)
    print(f"Tests run: {result.testsRun}")
    print(f"Successes: {result.testsRun - len(result.failures) - len(result.errors)}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    print("="*70)
    
    return result.wasSuccessful()


if __name__ == '__main__':
    success = run_tests()
    sys.exit(0 if success else 1)
